import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { createHeadlessEditor } from '@lexical/headless';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS
} from '@lexical/markdown';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { createBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import * as Y from 'yjs';

// 클라 NotionEditor의 등록 노드 중, 기본 TRANSFORMERS가 markdown에서 만들 수 있는 것만.
// Table/Image/File은 기본 마크다운 변환으로 생성되지 않으므로 서버에선 등록 불필요.
const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode
];

// createBinding은 provider를 안 쓰고, syncLexicalUpdateToYjs는 셀렉션 동기화 경로에서만 쓴다.
// 헤드리스 1회 변환엔 커서/셀렉션이 없으므로 최소 스텁으로 충분.
const fakeProvider = {
  awareness: {
    getLocalState: () => null,
    setLocalState: () => {},
    getStates: () => new Map(),
    on: () => {},
    off: () => {}
  },
  on: () => {},
  off: () => {}
} as any;

function createEditor() {
  return createHeadlessEditor({
    namespace: 'aideep',
    nodes: NODES,
    onError: (e) => {
      throw e;
    }
  });
}

function createDocBinding(doc: Y.Doc) {
  const editor = createEditor();
  const docMap = new Map<string, Y.Doc>([['main', doc]]);
  const binding = createBinding(editor, fakeProvider, 'main', doc, docMap);
  const root = doc.get('root', Y.XmlText);

  editor.update(
    () => {
      binding.root.applyChildrenYjsDelta(binding, root.toDelta());
      binding.root.syncChildrenFromYjs(binding);
    },
    { discrete: true }
  );

  return { binding, editor };
}

function registerYjsSync(
  editor: ReturnType<typeof createEditor>,
  binding: any
) {
  return editor.registerUpdateListener(
    ({
      prevEditorState,
      editorState,
      dirtyLeaves,
      dirtyElements,
      normalizedNodes,
      tags
    }) => {
      syncLexicalUpdateToYjs(
        binding,
        fakeProvider,
        prevEditorState,
        editorState,
        dirtyElements,
        dirtyLeaves,
        normalizedNodes,
        tags
      );
    }
  );
}

/**
 * markdownBody(마크다운 문자열) → @lexical/yjs 바인딩 포맷의 Y.Doc 업데이트(Uint8Array).
 * 클라 CollaborationPlugin이 doc.get('root', Y.XmlText)에서 이 트리를 읽어 렌더한다.
 * (기존 평문 xmlText.insert는 Lexical이 못 읽어 빈 화면 — 이슈 #71)
 */
export function markdownToYjsUpdate(markdown: string): Uint8Array {
  const doc = new Y.Doc();
  const editor = createEditor();
  const docMap = new Map<string, Y.Doc>([['main', doc]]);
  const binding = createBinding(editor, fakeProvider, 'main', doc, docMap);

  // 에디터 변경분을 Yjs로 흘려보내는 리스너 — 변환 update 전에 등록해야 diff가 잡힌다.
  const unregister = registerYjsSync(editor, binding);

  // discrete: true → 동기적으로 즉시 반영해 아래에서 바로 인코딩 가능
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    },
    { discrete: true }
  );

  unregister();
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

export function yjsDocToMarkdown(doc: Y.Doc): string {
  const { editor } = createDocBinding(doc);
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(TRANSFORMERS));
}

export function appendMarkdownToYjsDoc(
  doc: Y.Doc,
  markdown: string
): { markdown: string; update: Uint8Array } {
  const previousMarkdown = yjsDocToMarkdown(doc);
  const nextMarkdown = previousMarkdown
    ? `${previousMarkdown.replace(/\s+$/, '')}\n\n${markdown}`
    : markdown;
  const stateVector = Y.encodeStateVector(doc);
  const { binding, editor } = createDocBinding(doc);
  const unregister = registerYjsSync(editor, binding);

  editor.update(
    () => {
      $convertFromMarkdownString(nextMarkdown, TRANSFORMERS);
    },
    { discrete: true }
  );

  unregister();
  return {
    markdown: editor
      .getEditorState()
      .read(() => $convertToMarkdownString(TRANSFORMERS)),
    update: Y.encodeStateAsUpdate(doc, stateVector)
  };
}
