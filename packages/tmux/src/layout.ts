// Planner-on-left, workers-in-grid-on-right layouts for weave up.
//
// Given a freshly-created tmux session with one pane (the planner), build a
// layout for N worker panes on the right half:
//
//   N=1:  planner | worker
//   N=2:  planner | worker (top)
//                 | worker (bottom)
//   N=3:  planner | w1 | w2
//                 |   w3
//   N=4:  planner | w1 | w2
//                 | w3 | w4
//   N=5:  planner | w1 | w2
//                 | w3 | w4
//                 |   w5
//   N=6:  planner | w1 | w2
//                 | w3 | w4
//                 | w5 | w6

import { splitPane } from "./tmux.ts";

export async function buildPlannerLayout(session: string, workers: number): Promise<string[]> {
  if (workers < 1 || workers > 6) {
    throw new Error(`workers must be 1..6 (got ${workers})`);
  }

  // First split: planner keeps the left half, rightRoot is the whole right half.
  const rightRoot = await splitPane({ target: `${session}:0.0`, direction: "horizontal" });
  const workerPanes: string[] = [];

  switch (workers) {
    case 1:
      workerPanes.push(rightRoot);
      break;

    case 2: {
      const b = await splitPane({ target: rightRoot, direction: "vertical" });
      workerPanes.push(rightRoot, b);
      break;
    }

    case 3: {
      // top row (2 cols) + bottom row (1 col)
      const bottom = await splitPane({ target: rightRoot, direction: "vertical" });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal" });
      workerPanes.push(rightRoot, topRight, bottom);
      break;
    }

    case 4: {
      // 2x2
      const bottom = await splitPane({ target: rightRoot, direction: "vertical" });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal" });
      const bottomRight = await splitPane({ target: bottom, direction: "horizontal" });
      workerPanes.push(rightRoot, topRight, bottom, bottomRight);
      break;
    }

    case 5: {
      // 3 rows: top (2 cols) / middle (2 cols) / bottom (1 col)
      // Make 3 equal rows by splitting right into thirds.
      const middle = await splitPane({ target: rightRoot, direction: "vertical", percent: 67 });
      const bottom = await splitPane({ target: middle, direction: "vertical", percent: 50 });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal" });
      const middleRight = await splitPane({ target: middle, direction: "horizontal" });
      workerPanes.push(rightRoot, topRight, middle, middleRight, bottom);
      break;
    }

    case 6: {
      // 2x3: three rows of two columns each.
      const middle = await splitPane({ target: rightRoot, direction: "vertical", percent: 67 });
      const bottom = await splitPane({ target: middle, direction: "vertical", percent: 50 });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal" });
      const middleRight = await splitPane({ target: middle, direction: "horizontal" });
      const bottomRight = await splitPane({ target: bottom, direction: "horizontal" });
      workerPanes.push(rightRoot, topRight, middle, middleRight, bottom, bottomRight);
      break;
    }
  }

  return workerPanes;
}
