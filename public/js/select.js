// Wizard picker (characters track). API (see docs/agents/characters.md):
//   mountWizardPicker(container, { selected, onChange(id) }) -> { set(id), destroy() }
export function mountWizardPicker(container, { selected, onChange } = {}) {
  return { set() {}, destroy() {} };
}
