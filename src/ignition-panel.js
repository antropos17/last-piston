(function (root) {
  'use strict';
  class IgnitionPanel {
    constructor(action) {
      this.key = document.getElementById('ignition-key');
      this.label = document.getElementById('key-action');
      this.message = document.getElementById('start-message');
      this.boost = document.getElementById('battery-boost');
      this.key.addEventListener('click', () => action('key'));
      this.boost.addEventListener('click', () => action('boost'));
    }
    update(model) {
      const state = model.ignition;
      if (this.key.dataset.state !== state) {
        this.key.dataset.state = state;
        const action = state === 'running' ? 'Заглушить' : state === 'cranking' ? 'Прервать пуск' : 'Пуск';
        this.label.textContent = action;
        this.key.setAttribute('aria-label', action);
      }
      if (this.message.textContent !== model.startMessage) this.message.textContent = model.startMessage;
      this.boost.disabled = state !== 'off';
    }
  }
  root.Piston.IgnitionPanel = IgnitionPanel;
})(window);
