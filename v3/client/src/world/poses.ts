// Which mesh parts of a toy move, and where the (mirror) physics says they are.
// A pose is a world matrix; parts are drawn at pose(t) × inverse(pose(0)).
import { Matrix, Quaternion, Vector3 } from '../babylon';
import * as T from '../../../shared/toys';
import type { RigidBody } from '../../../shared/rapier';

export interface PartSpec {
  match: string | null;          // node-name key (null = the toy's whole model / scene child)
  pose: () => Matrix;
  center?: boolean;              // pose(0) is taken at the part's bounding centre
}

export function bodyMatrix(b: RigidBody): Matrix {
  const t = b.translation(), q = b.rotation();
  return Matrix.Compose(Vector3.One(), new Quaternion(q.x, q.y, q.z, q.w), new Vector3(t.x, t.y, t.z));
}

export function toyParts(toy: T.Toy): PartSpec[] {
  const p = toy.def.p;
  if (toy instanceof T.SwingToy) return toy.seats.map((s, i) => ({ match: p.seats?.[i] ?? null, pose: () => bodyMatrix(s.body) }));
  if (toy instanceof T.SeesawToy) return [{ match: p.part ?? null, pose: () => bodyMatrix(toy.beam) }];
  if (toy instanceof T.RoundaboutToy) return [{ match: p.part ?? null, pose: () => bodyMatrix(toy.deck) }];
  if (toy instanceof T.SpringRiderToy) return [{ match: p.part ?? null, pose: () => bodyMatrix(toy.body) }];
  if (toy instanceof T.SpinnerToy) return [{ match: p.part ?? null, pose: () => bodyMatrix(toy.body) }];
  if (toy instanceof T.DoorToy) return toy.leaves.map((l, i) => ({ match: p.leaves?.[i]?.part ?? null, pose: () => bodyMatrix(l.body) }));
  if (toy instanceof T.AirHockeyToy) return [
    { match: 'puck', pose: () => bodyMatrix(toy.puck), center: true },
    { match: 'player-a', pose: () => bodyMatrix(toy.mallets[0]), center: true },
    { match: 'player-b', pose: () => bodyMatrix(toy.mallets[1]), center: true }
  ];
  if (toy instanceof T.ClawToy) {
    const top = toy.area[4];
    return [{
      match: 'rotate-y', center: true,
      pose: () => {
        const w = toy.w([toy.claw[0], top + 0.2 - toy.drop * 0.22, toy.claw[1]]);
        return Matrix.Compose(Vector3.One(), Quaternion.RotationAxis(Vector3.Up(), toy.def.xf.rot), new Vector3(w[0], w[1], w[2]));
      }
    }];
  }
  return [];
}
