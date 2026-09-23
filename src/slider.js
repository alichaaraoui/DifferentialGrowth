/**
 * Labelled slider with an optional enable LED.
 *
 * Wraps a native range input so dragging, keyboard stepping and screen-reader
 * support come for free; the track fill is driven by a --pct custom property
 * set on the input, which the styled track pseudo-element reads.
 */

let uid = 0;

export class Slider {
  constructor(host, options) {
    this.host = host;
    this.min = options.min;
    this.max = options.max;
    this.step = options.step ?? 0.01;
    this.default = options.value;
    this.value = options.value;
    this.format = options.format ?? ((v) => v.toFixed(2));
    this.onChange = options.onChange ?? (() => {});
    this.label = options.label ?? '';
    this.toggle = options.toggle ?? null;
    this.id = `sl-${++uid}`;

    this.#build();
    this.#bind();
    this.render();
  }

  set(value, notify = true) {
    this.value = Math.min(this.max, Math.max(this.min, value));
    this.input.value = String(this.value);
    this.render();
    if (notify) this.onChange(this.value);
  }

  /** Return to the value the slider was created with. */
  reset(notify = true) {
    this.set(this.default, notify);
  }

  setEnabled(on) {
    if (!this.led) return;
    this.led.setAttribute('aria-pressed', on ? 'true' : 'false');
    this.led.setAttribute('aria-label', `${this.label} ${on ? 'on' : 'off'}`);
    this.host.classList.toggle('is-off', !on);
  }

  #build() {
    this.host.classList.add('ctl');
    this.host.innerHTML = `
      <div class="ctl-head">
        ${this.toggle ? `<button class="led-btn" aria-pressed="true" aria-label="${this.label} on"></button>` : ''}
        <label for="${this.id}">${this.label}</label>
        <b></b>
      </div>
      <input type="range" id="${this.id}"
             min="${this.min}" max="${this.max}" step="${this.step}" value="${this.value}">
    `;
    this.input = this.host.querySelector('input');
    this.readout = this.host.querySelector('.ctl-head b');
    this.led = this.host.querySelector('.led-btn');
  }

  render() {
    this.readout.textContent = this.format(this.value);
  }

  #bind() {
    this.input.addEventListener('input', () => {
      this.value = parseFloat(this.input.value);
      this.render();
      this.onChange(this.value);
    });
    this.input.addEventListener('dblclick', () => this.reset());

    if (this.toggle) {
      this.led.addEventListener('click', () => {
        const on = this.led.getAttribute('aria-pressed') !== 'true';
        this.setEnabled(on);
        this.toggle(on);
      });
    }
  }
}
