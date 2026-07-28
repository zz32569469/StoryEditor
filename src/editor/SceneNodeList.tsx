import { useEditor, useSelectedScene } from '../state/store';
import { stripTags } from '../tags/parse';
import { KIND_LABEL, summarizeNode } from './nodeKind';

/** 場景切換 + 該場景的台詞清單。 */
export function SceneNodeList() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const { selectScene, selectNode, addScene, updateScene, deleteScene, addNode, moveNode, deleteNode } =
    useEditor();
  const scene = useSelectedScene();

  if (!scene) {
    return (
      <div className="panel-section">
        <button type="button" onClick={addScene}>
          + 新增場景
        </button>
      </div>
    );
  }

  return (
    <div className="panel-section">
      <div className="row">
        <select value={scene.id} onChange={(e) => selectScene(e.target.value)}>
          {project.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={addScene} title="新增場景">
          +
        </button>
        <button
          type="button"
          className="danger"
          title="刪除這個場景"
          onClick={() => {
            if (confirm(`確定刪除場景「${scene.name}」？其中 ${scene.nodes.length} 句台詞會一起消失。`)) {
              deleteScene(scene.id);
            }
          }}
        >
          ✕
        </button>
      </div>

      <input
        className="scene-name"
        type="text"
        value={scene.name}
        onChange={(e) => updateScene(scene.id, { name: e.target.value })}
        placeholder="場景名稱"
      />

      <ol className="node-list">
        {scene.nodes.map((node, index) => {
          const text = stripTags(
            node.text[lang] ?? node.text[project.meta.baseLanguage] ?? '',
            project.tagRegistry,
          );
          const speaker = project.characters.find((c) => c.id === node.speaker);
          return (
            <li
              key={node.id}
              className={[
                node.id === selectedNodeId ? 'is-selected' : '',
                node.kind !== 'line' ? 'is-system' : '',
              ].join(' ')}
            >
              <button type="button" className="node-item" onClick={() => selectNode(node.id)}>
                <span className="node-index">{index + 1}</span>
                <span className="node-preview">
                  {node.kind !== 'line' && <em className="node-kind">{KIND_LABEL[node.kind]}</em>}
                  {speaker && <em>{speaker.name[project.meta.baseLanguage] ?? speaker.id}：</em>}
                  {summarizeNode(node, text)}
                </span>
                {node.choices.length > 0 && <span className="node-badge">{node.choices.length} 選項</span>}
              </button>
              <span className="node-actions">
                <button type="button" title="上移" onClick={() => moveNode(node.id, -1)}>
                  ↑
                </button>
                <button type="button" title="下移" onClick={() => moveNode(node.id, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  title="刪除這一句"
                  onClick={() => deleteNode(node.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      <button type="button" className="primary" onClick={addNode}>
        + 新增台詞
      </button>
    </div>
  );
}
