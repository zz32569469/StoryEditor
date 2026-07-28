import { useEditor } from '../state/store';

/** 角色管理。角色名可翻譯，因此也會出現在 Excel 的 Characters 工作表。 */
export function CharacterPanel() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const { addCharacter, updateCharacter, deleteCharacter } = useEditor();

  return (
    <div className="panel-section">
      {project.characters.length === 0 && (
        <p className="hint">還沒有角色。沒有角色的台詞會當成旁白。</p>
      )}

      {project.characters.map((character) => (
        <div key={character.id} className="character-row">
          <label className="field">
            <span>代號</span>
            <input
              type="text"
              value={character.id}
              onChange={(e) => updateCharacter(character.id, { id: e.target.value })}
              title="程式用的代號。改了會自動更新所有引用它的台詞。"
            />
          </label>
          <label className="field">
            <span>
              顯示名<em className="field-lang">{lang}</em>
            </span>
            <input
              type="text"
              value={character.name[lang] ?? ''}
              onChange={(e) =>
                updateCharacter(character.id, {
                  name: { ...character.name, [lang]: e.target.value },
                })
              }
            />
          </label>
          <label className="field">
            <span>預設立繪</span>
            <input
              type="text"
              value={character.defaultPortrait ?? ''}
              placeholder="例：warden_neutral"
              onChange={(e) =>
                updateCharacter(character.id, { defaultPortrait: e.target.value || undefined })
              }
            />
          </label>
          <button
            type="button"
            className="danger"
            onClick={() => deleteCharacter(character.id)}
            title="刪除角色（引用它的台詞會變成旁白）"
          >
            刪除角色
          </button>
        </div>
      ))}

      <button type="button" onClick={addCharacter}>
        + 新增角色
      </button>
    </div>
  );
}
