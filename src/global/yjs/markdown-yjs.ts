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
import { DecoratorNode, type SerializedLexicalNode } from 'lexical';
import { createBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import * as Y from 'yjs';

// 클라 NotionEditor의 ImageNode/FileNode 와 type·직렬화 필드를 맞춘 서버용 노드.
// 렌더링은 필요 없다. 다만 미등록 노드가 Yjs 문서에 있으면 바인딩이
// "Node image is not registered" 로 실패하므로 등록은 필수다.
// markdown 변환은 기본 TRANSFORMERS 그대로라 본문 텍스트(markdownBody)엔 나타나지 않는다.
type SerializedImageNode = SerializedLexicalNode & {
  src: string;
  caption?: string;
};

type SerializedFileNode = SerializedLexicalNode & {
  name: string;
  size: number;
  dataUrl?: string;
};

class ImageNode extends DecoratorNode<null> {
  __src: string;
  __caption: string;

  static getType(): string {
    return 'image';
  }
  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__caption, node.__key);
  }
  static importJSON(s: SerializedImageNode): ImageNode {
    return new ImageNode(s.src, s.caption ?? '');
  }

  constructor(src: string, caption = '', key?: string) {
    super(key);
    this.__src = src;
    this.__caption = caption;
  }

  exportJSON() {
    return {
      type: 'image',
      version: 1,
      src: this.__src,
      caption: this.__caption
    };
  }
  createDOM(): any {
    throw new Error('ImageNode 는 헤드리스 전용이라 DOM 을 만들지 않는다');
  }
  updateDOM(): false {
    return false;
  }
  decorate(): null {
    return null;
  }
}

class FileNode extends DecoratorNode<null> {
  __name: string;
  __size: number;
  __dataUrl: string;

  static getType(): string {
    return 'file';
  }
  static clone(node: FileNode): FileNode {
    return new FileNode(node.__name, node.__size, node.__dataUrl, node.__key);
  }
  static importJSON(s: SerializedFileNode): FileNode {
    return new FileNode(s.name, s.size, s.dataUrl ?? '');
  }

  constructor(name: string, size: number, dataUrl: string, key?: string) {
    super(key);
    this.__name = name;
    this.__size = size;
    this.__dataUrl = dataUrl;
  }

  exportJSON() {
    return {
      type: 'file',
      version: 1,
      name: this.__name,
      size: this.__size,
      dataUrl: this.__dataUrl
    };
  }
  createDOM(): any {
    throw new Error('FileNode 는 헤드리스 전용이라 DOM 을 만들지 않는다');
  }
  updateDOM(): false {
    return false;
  }
  decorate(): null {
    return null;
  }
}

// 클라 NotionEditor의 등록 노드 중 서버가 읽어야 하는 것.
// Table 은 기본 마크다운 변환으로 생성되지 않으므로 서버에선 등록 불필요.
const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  ImageNode,
  FileNode
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

/**
 * 첨부 동기화(syncNodeAttachments)용 content.
 * 본문 이미지/파일 노드의 S3 URL 은 markdownBody 에 나오지 않으므로,
 * Yjs 문서를 Lexical 상태 JSON 으로 풀어 URL 이 문자열로 담기게 한다.
 * (저장용이 아니라 URL 추출 입력용이다)
 */
export function yjsDocToAttachmentContent(doc: Y.Doc): Record<string, unknown> {
  const { editor } = createDocBinding(doc);
  return { editorState: editor.getEditorState().toJSON() };
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
