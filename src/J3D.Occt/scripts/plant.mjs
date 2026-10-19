// A generated, licence-free hierarchical assembly (D156, D161): a "plant" of production lines, each
// with a conveyor of its own and stations that are one shared assembly placed again and again:
//
//   Plant › Line n › Station n › Robot › Arm › Wrist › Gripper
//                  › Conveyor n › Frame, Roller × 2 per station
//
// 24 parts per station and one per line (its conveyor's frame), 7 levels deep. Parts and assemblies
// are reused as instances (one Station, Robot, Bolt and Roller shape), while each line's conveyor and
// frame are its own. The Guard and the Gripper are compound parts, one shape holding several solids,
// for Expand (D154). Placements turn as well as move, so frames have something to show.
//
// Written by OCCT in Node (xcaf.mjs): plant.step is committed (generate-fixtures.mjs), larger ones
// are written on demand into tests/fixtures/large/ (generate-large-step.mjs, `plant-<parts>`).

/** Parts in one line of `stations` stations: 24 per station, plus the conveyor's frame. */
export const partsPerLine = (stations) => stations * 24 + 1;

/** The plant's STEP bytes. */
export function buildPlant(occt, { lines, stations }) {
  const { text, rgba, surf, box, cylinder, cylinderAt, moved, compound, placement, newDocument } = occt;
  const { doc, shapes, colors } = newDocument();

  const part = (name, shape, colour) => {
    const label = shapes.AddShape(shape, false, true);
    occt.oc.TDataStd_Name.Set(label, text(name));
    colors.SetColor(label, colour, surf);
    return label;
  };
  const assembly = (name) => {
    const label = shapes.NewShape();
    occt.oc.TDataStd_Name.Set(label, text(name));
    return label;
  };
  const add = (parent, child, name, location) => {
    occt.oc.TDataStd_Name.Set(shapes.AddComponent(parent, child, location), text(name));
  };

  const steel = rgba(0.62, 0.64, 0.68);
  const bolt = part('Bolt M12', cylinder(6, 30), steel);

  // Robot › Arm › Wrist › Gripper: the gripper is one part of two fingers (a compound).
  const gripper = part('Gripper', compound(box(20, 60, 80), moved(box(20, 60, 80), 60, 0, 0)), rgba(0.15, 0.15, 0.17));
  const wrist = assembly('Wrist');
  add(wrist, part('Joint', cylinder(45, 60), rgba(0.2, 0.22, 0.25)), 'Joint', placement(0, 0, 0));
  add(wrist, gripper, 'Gripper', placement(-50, -30, 60));

  const orange = rgba(0.95, 0.45, 0.08);
  const arm = assembly('Arm');
  add(arm, part('Link 1', box(100, 100, 400), orange), 'Link 1', placement(-50, -50, 0));
  add(arm, part('Link 2', box(400, 80, 80), orange), 'Link 2', placement(-40, -40, 400));
  add(arm, part('Link 3', box(300, 60, 60), orange), 'Link 3', placement(360, -30, 410));
  add(arm, wrist, 'Wrist', placement(690, 0, 440, 0, 90));

  const robot = assembly('Robot');
  add(robot, part('Base', cylinder(150, 200), rgba(0.25, 0.27, 0.3)), 'Base', placement(0, 0, 0));
  add(robot, arm, 'Arm', placement(0, 0, 200, 30));
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    add(robot, bolt, `Bolt ${i + 1}`, placement(120 * Math.cos(angle), 120 * Math.sin(angle), 200));
  }

  // Station: a table, the robot, eight bolts and a guard of three panels (a compound part).
  const guardColour = rgba(0.9, 0.8, 0.1, 0.5);
  const guard = part(
    'Guard',
    compound(box(1200, 20, 1000), moved(box(20, 800, 1000), 0, 20, 0), moved(box(20, 800, 1000), 1180, 20, 0)),
    guardColour,
  );
  const station = assembly('Station');
  add(station, part('Table', box(1200, 800, 750), rgba(0.45, 0.47, 0.5)), 'Table', placement(-600, -400, 0));
  add(station, robot, 'Robot', placement(0, 0, 750, 15));
  add(station, guard, 'Guard', placement(-600, 420, 0));
  for (let i = 0; i < 8; i++) {
    add(station, bolt, `Bolt ${i + 1}`, placement(-560 + (i % 4) * 373, i < 4 ? -360 : 360, 750));
  }

  const roller = part('Roller', cylinderAt(0, -300, 0, 40, 600, 0, 1, 0), rgba(0.3, 0.3, 0.32));
  const spacing = 2000;
  const plant = assembly('Plant');
  for (let line = 1; line <= lines; line++) {
    const length = stations * spacing;
    const lineLabel = assembly(`Line ${line}`);
    // Each line's conveyor is its own assembly, with a frame of its own length.
    const conveyor = assembly(`Conveyor ${line}`);
    add(conveyor, part(`Frame ${line}`, box(length, 700, 60), rgba(0.1, 0.3, 0.7)), 'Frame', placement(0, -350, 0));
    for (let r = 0; r < stations * 2; r++) {
      add(conveyor, roller, `Roller ${r + 1}`, placement(spacing / 4 + r * (spacing / 2), 0, 100));
    }
    add(lineLabel, conveyor, `Conveyor ${line}`, placement(0, -1200, 0));
    for (let s = 1; s <= stations; s++) {
      add(lineLabel, station, `Station ${s}`, placement(spacing / 2 + (s - 1) * spacing, 0, 0));
    }
    add(plant, lineLabel, `Line ${line}`, placement(0, (line - 1) * 3500, 0));
  }
  shapes.UpdateAssemblies();
  return occt.stepBytes(doc, 'plant.step');
}
