const NativeDate = Date;
const fixed = NativeDate.parse("2026-11-06T00:00:00.123Z");
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [fixed]));
  }
  static now() {
    return fixed;
  }
};
