// Single source of truth for "is this model a toy, and what does it do?".
// Used by tools/model-table.mjs (docs/MODELS.md) and by the tests, which check
// that every "Yes" model placed in world/layout.json has a working behaviour.
//
// playable: 'Yes' = must work as a toy; 'Walk' = walkable structure (floors, steps);
//           'No'  = scenery with a collider (or none for floors/shrubs).
// behaviour: the layout behaviour that implements it.
export const RULES = [
  // Kenney Mini Arcade
  [/air-hockey/, 'Yes', 'airHockey', 'Two players push the puck; goals count'],
  [/arcade-machine|pinball|dance-machine|ticket-machine|vending-machine/, 'Yes', 'machine', 'Lights up when you stand in front; starts a short mini-challenge'],
  [/gambling-machine/, 'Yes', 'machine', 'Would light up like a cabinet — not placed (slot machine theme is not for children)'],
  [/basketball-game/, 'Yes', 'hoop', 'Throw the ball into the hoop; score counts'],
  [/claw-machine/, 'Yes', 'claw', 'Controllable claw grabs a prize'],
  [/prize-wheel/, 'Yes', 'spinner', 'Spins when pushed (revolute joint)'],
  [/wall-door-rotate/, 'Yes', 'door', 'Doors swing open when you walk into them'],
  [/character-(employee|gamer)/, 'No', 'box', 'Arcade staff figure — not placed (players use the family characters)'],
  [/kenney-mini-arcade\/(cash-register|column|prizes|wall|wall-corner|wall-window)\.glb/, 'No', 'box', 'Scenery with a box collider'],
  [/kenney-mini-arcade\/floor/, 'No', 'none', 'Floor tile'],
  // Kenney Mini Characters
  [/character-(male|female)/, 'Avatar', 'player', 'Family character (capsule body, outfit colour via the UV palette)'],
  [/aid-(glasses|sunglasses)/, 'Accessory', 'accessory', 'Attached to the head bone'],
  [/aid|wheelchair/, 'No', '-', 'Mobility / medical aid — not placed'],
  // Tiny Treats
  [/swing_/, 'Yes', 'swing', 'Revolute joint; sit, pump, push'],
  [/seesaw_/, 'Yes', 'seesaw', 'Pivot joint; tilts under weight'],
  [/merry_go_round/, 'Yes', 'roundabout', 'Spins when pushed; carries riders'],
  [/spring_horse/, 'Yes', 'springRider', 'Spring-loaded joint; wobbles'],
  [/slide_[AB]/, 'Yes', 'slide', 'Ladder up, spline ride down'],
  [/monkeybar_A/, 'Yes', 'hang', 'Hang and move along the bars; jump off'],
  [/monkeybar_B/, 'Yes', 'climb', 'Arch ladder: climb up and over, jump off'],
  [/sandbox_/, 'Yes', 'sandbox', 'Soft ground, footprints, build a pile'],
  [/sandcastle_|bucket_|shovel_|tire_|cart\.gltf/, 'Yes', 'dynamic', 'Light dynamic body: push, kick'],
  [/stepping_stumps/, 'Walk', 'box', 'Hop from stump to stump'],
  [/tree_(large|small)/, 'Yes', 'tree', 'Trunk collider; shakes and drops leaves when bumped'],
  [/picnic_table/, 'No', 'box', 'Heavy table, box collider'],
  [/fence_/, 'No', 'box', 'Fence, box collider'],
  // Kenney Furniture Kit
  [/\/(chair|chairCushion|chairModernCushion|chairModernFrameCushion|chairRounded|chairDesk|stoolBar|stoolBarSquare)\.glb/, 'Yes', 'dynamic', 'Light chair: push it around'],
  [/\/(pillow\w*|loungeSofaOttoman|benchCushionLow|bear|cardboardBox\w*|books|trashcan|tableCoffee\w*|sideTable|kitchenBlender|toaster|radio|lampRoundTable|lampSquareTable|plantSmall\d|laptop|computer\w*)\.glb/, 'Yes', 'dynamic', 'Light object: push, knock over'],
  [/\/(table|tableCloth|tableCross|tableCrossCloth|tableGlass|tableRound)\.glb/, 'Yes', 'dynamic', 'Small table: heavier dynamic body'],
  [/\/(doorway|doorwayFront)\.glb/, 'Yes', 'door', 'Door opens when you walk into it'],
  [/\/(stairs\w*)\.glb/, 'Walk', 'box', 'Walkable steps'],
  [/\/(floor\w*|rug\w*|paneling)\.glb/, 'No', 'none', 'Floor / rug, no collider'],
  [/kenney-furniture-kit/, 'No', 'box', 'Furniture, box collider'],
  // Starter scenes
  [/city-park-playground-starter/, 'Scene', 'children', 'See the child table below'],
  [/trampoline-park-soft-play-starter/, 'Scene', 'children', 'See the child table below'],
];

// Children of the two starter scenes (name without the numeric prefix).
export const CHILD_RULES = [
  [/floor-tile|lawn-tile|path-tile|safety-surface-tile/, 'No', 'none', 'Floor tile (merged, no collider)'],
  [/ceiling-truss/, 'No', 'none', 'Overhead truss'],
  [/playground-sign|notice-board|safety-sign-set|briefing-screen|grip-sock-display/, 'No', 'excluded', 'Text sign — excluded (no signs in the world)'],
  [/trampoline-bed-module|performance-trampoline|angled-trampoline|wall-trampoline/, 'Yes', 'bounce', 'Bounce surface with a visible dip'],
  [/airbag-landing-block|tumble-track/, 'Yes', 'bounce', 'Soft bounce surface'],
  [/foam-pit/, 'Yes', 'softPit', 'Soft landing pit, slows you down'],
  [/ball-pit/, 'Yes', 'ballPit', 'Ball pit full of dynamic balls'],
  [/basketball-dunk-hoop/, 'Yes', 'hoop', 'Throw the ball through the hoop; score counts'],
  [/spinner-seat/, 'Yes', 'spinner', 'Spins when pushed (revolute joint)'],
  [/roller-slide/, 'Yes', 'slide', 'Spline ride down'],
  [/soft-play-frame-tower-with-slide/, 'Yes', 'tower', 'Walkable deck, steps up, slide down'],
  [/crawl-tunnel/, 'Yes', 'tunnel', 'Crawl through (side walls only)'],
  [/balance-beam|padded-step-block|court-edge-platform|toddler-play-mat/, 'Walk', 'box', 'Walkable block'],
  [/cleaning-trolley|waste-bin|litter-bin|dog-waste-bin/, 'Yes', 'dynamic', 'Light dynamic body'],
  [/swing-set/, 'Yes', 'swing', 'Revolute joints on each seat; sit, pump, push'],
  [/play-tower-with-roof/, 'Yes', 'tower', 'Walkable deck, ladder up, pole/slide down'],
  [/climbing-frame|rope-net-climber/, 'Yes', 'climb', 'Climbable; hang, climb, jump off'],
  [/monkey-bars/, 'Yes', 'hang', 'Hang and move along the bars'],
  [/sandpit/, 'Yes', 'sandbox', 'Soft ground, footprints, build a pile'],
  [/playground-slide/, 'Yes', 'slide', 'Spline ride from the top to the bottom'],
  [/roundabout/, 'Yes', 'roundabout', 'Spins when pushed; carries riders'],
  [/seesaw/, 'Yes', 'seesaw', 'Pivot joint; tilts under weight'],
  [/spring-rocker/, 'Yes', 'springRider', 'Spring-loaded joint; wobbles'],
  [/fence-gate|park-gate/, 'Yes', 'door', 'Gate swings open when you walk into it'],
  [/duck-pond/, 'Yes', 'water', 'Splash when you walk in'],
  [/drinking-fountain/, 'Yes', 'water', 'Splash and sound when you touch it'],
  [/park-tree/, 'Yes', 'tree', 'Trunk collider; shakes and drops leaves'],
  [/lamp-post|bollard/, 'No', 'trunk', 'Thin post collider'],
  [/shrub-clump|flower-bed/, 'No', 'none', 'Soft planting, no collider'],
  [/park-bandstand/, 'Walk', 'stage', 'Walkable stage with posts'],
  [/./, 'No', 'box', 'Scenery with a box collider'],
];

export function classify(file) {
  const r = RULES.find(([re]) => re.test(file));
  return r ? { playable: r[1], behaviour: r[2], note: r[3] } : { playable: 'No', behaviour: 'box', note: 'Scenery' };
}
export function classifyChild(name) {
  const r = CHILD_RULES.find(([re]) => re.test(name));
  return { playable: r[1], behaviour: r[2], note: r[3] };
}
