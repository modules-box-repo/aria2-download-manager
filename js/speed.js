// Wires every speed limit control to the shared unit picker
const SpeedControls = {
  add: null,
  item: null,
  up: null,
  dl: null,
  odl: null,
  ul: null,
  init() {
    this.add = bindSpeed('#add-limit', '#sv-add-limit');
    this.up = bindSpeed('#add-ul-limit', '#sv-add-ul-limit');
    this.item = bindSpeed('#item-limit', '#item-limit-out');
    this.itemUp = bindSpeed('#item-up', '#item-up-out');
    this.dl = bindSpeed('#set-dl-limit', '#sv-dl-limit');
    this.odl = bindSpeed('#set-odl-limit', '#sv-odl-limit');
    this.ul = bindSpeed('#set-ul-limit', '#sv-ul-limit');
    this.oul = bindSpeed('#set-oul-limit', '#sv-oul-limit');
  },
  setItem(kib) {
    this.item.write(kib);
  },
  readItem() {
    return this.item.read();
  },
  setItemUp(kib) {
    this.itemUp.write(kib);
  },
  readItemUp() {
    return this.itemUp.read();
  }
};

SpeedControls.init();
