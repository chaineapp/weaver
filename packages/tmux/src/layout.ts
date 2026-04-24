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

export async function buildPlannerLayout(
  session: string,
  workers: number,
  opts: { cwd?: string } = {},
): Promise<string[]> {
  if (workers < 1 || workers > 6) {
    throw new Error(`workers must be 1..6 (got ${workers})`);
  }

  const cwd = opts.cwd;

  // First split: planner keeps the left half, rightRoot is the whole right half.
  const rightRoot = await splitPane({ target: `${session}:0.0`, direction: "horizontal", cwd });
  const workerPanes: string[] = [];

  switch (workers) {
    case 1:
      workerPanes.push(rightRoot);
      break;

    case 2: {
      const b = await splitPane({ target: rightRoot, direction: "vertical", cwd });
      workerPanes.push(rightRoot, b);
      break;
    }

    case 3: {
      const bottom = await splitPane({ target: rightRoot, direction: "vertical", cwd });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal", cwd });
      workerPanes.push(rightRoot, topRight, bottom);
      break;
    }

    case 4: {
      const bottom = await splitPane({ target: rightRoot, direction: "vertical", cwd });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal", cwd });
      const bottomRight = await splitPane({ target: bottom, direction: "horizontal", cwd });
      workerPanes.push(rightRoot, topRight, bottom, bottomRight);
      break;
    }

    case 5: {
      const middle = await splitPane({ target: rightRoot, direction: "vertical", percent: 67, cwd });
      const bottom = await splitPane({ target: middle, direction: "vertical", percent: 50, cwd });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal", cwd });
      const middleRight = await splitPane({ target: middle, direction: "horizontal", cwd });
      workerPanes.push(rightRoot, topRight, middle, middleRight, bottom);
      break;
    }

    case 6: {
      const middle = await splitPane({ target: rightRoot, direction: "vertical", percent: 67, cwd });
      const bottom = await splitPane({ target: middle, direction: "vertical", percent: 50, cwd });
      const topRight = await splitPane({ target: rightRoot, direction: "horizontal", cwd });
      const middleRight = await splitPane({ target: middle, direction: "horizontal", cwd });
      const bottomRight = await splitPane({ target: bottom, direction: "horizontal", cwd });
      workerPanes.push(rightRoot, topRight, middle, middleRight, bottom, bottomRight);
      break;
    }
  }

  return workerPanes;
}
