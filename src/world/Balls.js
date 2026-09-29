// Interactive balls: free balls bob on the floor, carried balls follow the
// holder's carry anchor, passes fly in an arc. State always comes from the room.
import { CreateSphere, Vector3, Mesh } from '../babylon.js';
import { BALL_COLORS, BASKETS } from '../../shared/playground.js';

export class Balls {
  constructor(scene, kit, shadows) {
    this.scene = scene;
    this.kit = kit;
    this.shadows = shadows;
    this.meshes = new Map();
    this.state = new Map();
    this.flights = new Map();
    this.symbols = new Map();
    this.showSymbols = false;
    this.source = CreateSphere('ball-src', { diameter: 0.46, segments: 12 }, scene);
    this.source.setEnabled(false);
    this.band = CreateSphere('band-src', { diameter: 0.47, segments: 12, slice: 0.5 }, scene);
    this.band.setEnabled(false);
  }

  symbolSign(colorId) {
    if (!this.symbols.has(colorId)) {
      const def = BALL_COLORS.find(c => c.id === colorId);
      const sign = this.kit.sign(`sym-${colorId}`, { symbol: def.symbol, color: def.color, width: 0.42, height: 0.42 });
      sign.setEnabled(false);
      this.symbols.set(colorId, sign);
    }
    return this.symbols.get(colorId);
  }

  sync(list) {
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let mesh = this.meshes.get(b.id);
      if (!mesh) {
        const def = BALL_COLORS.find(c => c.id === b.color);
        mesh = this.source.clone(`ball-${b.id}`);
        mesh.setEnabled(true);
        mesh.material = this.kit.mat(def?.color || '#FFFFFF', { gloss: 0.55, emissive: 0.18 });
        const stripe = this.band.clone('stripe');
        stripe.setEnabled(true); stripe.parent = mesh; stripe.scaling.set(0.99, 0.3, 0.99);
        stripe.material = this.kit.mat('#FFFFFF', { gloss: 0.5, emissive: 0.3 });
        const icon = this.symbolSign(b.color).clone(`sym-${b.id}`);
        icon.setEnabled(true);
        icon.parent = mesh; icon.position.y = 0.55; icon.billboardMode = Mesh.BILLBOARDMODE_ALL;
        mesh.metadata = { icon };
        mesh.position.set(b.x, b.y, b.z);
        this.shadows?.addMesh(mesh);
        this.meshes.set(b.id, mesh);
      }
      const prev = this.state.get(b.id);
      this.state.set(b.id, { ...b });
      mesh.setEnabled(!b.done);
      if (prev && prev.holder && !b.holder && b.done) this.popIntoBasket(mesh, b);
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) { this.shadows?.removeMesh(mesh); mesh.dispose(); this.meshes.delete(id); this.state.delete(id); }
    }
  }

  popIntoBasket(mesh, b) {
    const basket = BASKETS.find(k => k.id === b.color);
    if (!basket) return;
    mesh.setEnabled(true);
    this.flights.set(b.id, { from: mesh.position.clone(), to: new Vector3(basket.x, 0.7, basket.z), t: 0, dur: 0.35, hideAfter: true });
  }

  startPass(ballId, fromPos) {
    const mesh = this.meshes.get(ballId);
    if (!mesh) return;
    this.flights.set(ballId, { from: fromPos.clone(), t: 0, dur: 0.45, toHolder: true });
  }

  // anchorFor(playerId) -> world position of that player's carry anchor, or null
  update(dt, time, anchorFor) {
    for (const [id, mesh] of this.meshes) {
      const b = this.state.get(id);
      if (!b) continue;
      mesh.metadata.icon.setEnabled(this.showSymbols && !b.holder && !b.done);
      const flight = this.flights.get(id);
      if (flight) {
        flight.t += dt / flight.dur;
        const to = flight.toHolder ? (anchorFor(b.holder) || flight.from) : flight.to;
        const k = Math.min(1, flight.t);
        mesh.position = Vector3.Lerp(flight.from, to, k);
        mesh.position.y += Math.sin(k * Math.PI) * (flight.toHolder ? 1.4 : 0.6);
        if (flight.t >= 1) {
          this.flights.delete(id);
          if (flight.hideAfter) mesh.setEnabled(false);
        }
        continue;
      }
      if (b.done) continue;
      if (b.holder) {
        const a = anchorFor(b.holder);
        if (a) { mesh.position.copyFrom(a); mesh.rotation.y += dt * 2; }
      } else {
        const bob = Math.sin(time * 3 + id) * 0.05;
        mesh.position.set(b.x, 0.26 + Math.max(0, bob), b.z);
        mesh.rotation.y += dt * 0.8;
      }
    }
  }

  get(id) { return this.state.get(id); }
  list() { return [...this.state.values()]; }
}
