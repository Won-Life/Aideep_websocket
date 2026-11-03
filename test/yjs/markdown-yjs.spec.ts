import * as Y from 'yjs';
import { createHeadlessEditor } from '@lexical/headless';
import { createBinding, syncLexicalUpdateToYjs } from '@lexical/yjs';
import { $createParagraphNode, $getRoot, DecoratorNode } from 'lexical';
import {
  appendMarkdownToYjsDoc,
  markdownToYjsUpdate,
  yjsDocToAttachmentContent,
  yjsDocToMarkdown
} from '@global/yjs/markdown-yjs';

// 클라 NotionEditor 의 ImageNode/FileNode 와 같은 type/직렬화 필드를 가진 테스트용 노드.
// 클라이언트가 Yjs 에 심는 문서를 서버 테스트에서 재현하기 위해 쓴다.
class ClientImageNode extends DecoratorNode<null> {
  __src: string;
  __caption: string;
  static getType() {
    return 'image';
  }
  static clone(n: ClientImageNode) {
    return new ClientImageNode(n.__src, n.__caption, n.__key);
  }
  static importJSON(s: any) {
    return new ClientImageNode(s.src, s.caption ?? '');
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
  createDOM() {
    return document.createElement('div');
  }
  updateDOM() {
    return false;
  }
  decorate() {
    return null;
  }
}

class ClientFileNode extends DecoratorNode<null> {
  __name: string;
  __size: number;
  __dataUrl: string;
  static getType() {
    return 'file';
  }
  static clone(n: ClientFileNode) {
    return new ClientFileNode(n.__name, n.__size, n.__dataUrl, n.__key);
  }
  static importJSON(s: any) {
    return new ClientFileNode(s.name, s.size, s.dataUrl ?? '');
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
  createDOM() {
    return document.createElement('div');
  }
  updateDOM() {
    return false;
  }
  decorate() {
    return null;
  }
}

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

/** 클라이언트가 이미지/파일 노드를 본문에 넣었을 때의 Yjs 문서를 만든다. */
function buildClientDoc(imageUrl: string, fileUrl: string): Y.Doc {
  const doc = new Y.Doc();
  const editor = createHeadlessEditor({
    namespace: 'client',
    nodes: [ClientImageNode, ClientFileNode],
    onError: (e) => {
      throw e;
    }
  });
  const binding = createBinding(
    editor,
    fakeProvider,
    'main',
    doc,
    new Map([['main', doc]])
  );
  editor.registerUpdateListener(
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
  editor.update(
    () => {
      const root = $getRoot();
      root.append(
        $createParagraphNode(),
        new ClientImageNode(imageUrl, '설명'),
        new ClientFileNode('report.pdf', 1024, fileUrl)
      );
    },
    { discrete: true }
  );
  return doc;
}

describe('본문 이미지/파일 노드가 있는 Yjs 문서', () => {
  const IMG =
    'https://bucket.s3.ap-northeast-2.amazonaws.com/uploads/img-1.png';
  const FILE =
    'https://bucket.s3.ap-northeast-2.amazonaws.com/uploads/doc-1.pdf';

  it('yjsDocToMarkdown 이 이미지/파일 노드 때문에 예외를 던지지 않는다', () => {
    const doc = buildClientDoc(IMG, FILE);
    expect(() => yjsDocToMarkdown(doc)).not.toThrow();
    doc.destroy();
  });

  it('yjsDocToAttachmentContent 가 이미지/파일의 S3 URL 을 담아 돌려준다', () => {
    const doc = buildClientDoc(IMG, FILE);
    const text = JSON.stringify(yjsDocToAttachmentContent(doc));
    expect(text).toContain(IMG);
    expect(text).toContain(FILE);
    doc.destroy();
  });

  it('이미지/파일이 없는 문서는 URL 없이 예외 없이 처리한다', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, markdownToYjsUpdate('# 제목'));
    expect(() => yjsDocToAttachmentContent(doc)).not.toThrow();
    expect(JSON.stringify(yjsDocToAttachmentContent(doc))).not.toContain(
      'amazonaws'
    );
    doc.destroy();
  });

  it('markdownBody 출력은 이미지/파일 노드 도입 전과 같다(URL 이 섞이지 않는다)', () => {
    const doc = buildClientDoc(IMG, FILE);
    expect(yjsDocToMarkdown(doc)).not.toContain('amazonaws');
    doc.destroy();
  });
});

// Y.XmlText/XmlElement 트리를 순회해 텍스트만 뽑는다 (렌더될 실제 내용 확인용)
function collectText(node: any): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((d: any) =>
        typeof d.insert === 'string' ? d.insert : collectText(d.insert)
      )
      .join('');
  }
  if (node instanceof Y.XmlElement) {
    return node.toArray().map(collectText).join('');
  }
  return '';
}

describe('markdownToYjsUpdate', () => {
  const MD = '# 회의 제목\n\n- 항목1\n- 항목2';

  function decode(update: Uint8Array) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, update);
    return doc.get('root', Y.XmlText);
  }

  it('평문이 아니라 Lexical 노드 구조(XmlElement 임베드)를 만든다', () => {
    const root = decode(markdownToYjsUpdate(MD));
    const delta = root.toDelta();

    // 버그판은 delta[0].insert가 원문 문자열(평문). 정상판은 임베드된 XmlElement.
    expect(delta.length).toBeGreaterThan(0);
    expect(typeof delta[0].insert).not.toBe('string');
    expect(root.toString()).not.toBe(MD); // 원문 그대로가 아님
  });

  it('마크다운 내용(제목·항목)이 보존된다', () => {
    const text = collectText(decode(markdownToYjsUpdate(MD)));
    expect(text).toContain('회의 제목');
    expect(text).toContain('항목1');
    expect(text).toContain('항목2');
  });

  it('빈 문자열도 예외 없이 처리한다', () => {
    expect(() => markdownToYjsUpdate('')).not.toThrow();
  });

  it('구조화된 Y.Doc을 Markdown으로 왕복 변환한다', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, markdownToYjsUpdate(MD));

    const markdown = yjsDocToMarkdown(doc);

    expect(markdown).toContain('# 회의 제목');
    expect(markdown).toContain('- 항목1');
    expect(markdown).toContain('- 항목2');
    doc.destroy();
  });

  it('기존 Lexical 구조를 보존하며 Markdown 블록을 append한다', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, markdownToYjsUpdate(MD));
    const stateVector = Y.encodeStateVector(doc);

    const result = appendMarkdownToYjsDoc(
      doc,
      '## 결정 사항\n\n> 실시간 노드 편집을 우선한다.'
    );

    expect(result.markdown).toContain('# 회의 제목');
    expect(result.markdown).toContain('## 결정 사항');
    expect(result.markdown).toContain('> 실시간 노드 편집을 우선한다.');
    expect(result.update.byteLength).toBeGreaterThan(0);
    expect(Y.encodeStateAsUpdate(doc, stateVector)).toEqual(result.update);

    const root = doc.get('root', Y.XmlText);
    expect(root.toDelta().some((item) => typeof item.insert !== 'string')).toBe(
      true
    );
    doc.destroy();
  });
});
