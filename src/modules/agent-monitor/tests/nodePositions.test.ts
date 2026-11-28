// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { NO_SAVED_POSITIONS, placeNodes, pruneSavedPositions, recordPositions, type SavedPositions } from '@/modules/agent-monitor/graph/nodePositions';

/** The rules that keep a dragged box where the user put it while a fresh snapshot redraws the graph. */

const node = (id: string, x: number, y: number) => ({ id, position: { x, y }, label: id });

describe('placeNodes', () => {
  it('puts the dragged position over the layout one, and leaves a box that was never dragged exactly as the layout placed it', () => {
    const layout = [node('a', 0, 0), node('b', 178, 0), node('c', 356, 0)];
    const placed = placeNodes(layout, { b: { x: 500, y: 90 } });

    expect(placed[1].position).toEqual({ x: 500, y: 90 });
    expect(placed[1].label).toBe('b');
    expect(placed[0]).toBe(layout[0]);
    expect(placed[2]).toBe(layout[2]);
  });

  it('gives a NEW box (no saved position) the layout position, while an old one keeps its dragged one across snapshots', () => {
    const saved: SavedPositions = { a: { x: 40, y: 40 } };
    // Snapshot 1: only `a`. Snapshot 2: the layout shifted `a` and added `n`.
    const second = placeNodes([node('a', 10, 10), node('n', 356, 70)], saved);
    expect(second.find((entry) => entry.id === 'a')?.position).toEqual({ x: 40, y: 40 });
    expect(second.find((entry) => entry.id === 'n')?.position).toEqual({ x: 356, y: 70 });
  });

  it('is the layout unchanged when nothing was dragged', () => {
    const layout = [node('a', 0, 0)];
    expect(placeNodes(layout, NO_SAVED_POSITIONS)[0]).toBe(layout[0]);
  });
});

describe('pruneSavedPositions', () => {
  it('drops the position of a box that left the picture and keeps the others', () => {
    const saved: SavedPositions = { a: { x: 1, y: 1 }, gone: { x: 2, y: 2 } };
    expect(pruneSavedPositions(saved, ['a', 'new'])).toEqual({ a: { x: 1, y: 1 } });
  });

  it('returns the same object when every saved box is still drawn, so the caller can skip a state update', () => {
    const saved: SavedPositions = { a: { x: 1, y: 1 } };
    expect(pruneSavedPositions(saved, ['a', 'b'])).toBe(saved);
    expect(pruneSavedPositions(NO_SAVED_POSITIONS, [])).toBe(NO_SAVED_POSITIONS);
  });

  it('a box that left and came back starts from the layout again', () => {
    const saved: SavedPositions = { a: { x: 9, y: 9 } };
    const afterLeaving = pruneSavedPositions(saved, ['b']);
    expect(placeNodes([node('a', 0, 0)], afterLeaving)[0].position).toEqual({ x: 0, y: 0 });
  });
});

describe('recordPositions', () => {
  it('records position changes only (React Flow also reports dimensions and selection)', () => {
    const next = recordPositions(NO_SAVED_POSITIONS, [
      { id: 'a', type: 'position', position: { x: 5, y: 6 } },
      { id: 'a', type: 'dimensions' },
      { id: 'b', type: 'select' },
      { id: 'c', type: 'position' },
    ]);
    expect(next).toEqual({ a: { x: 5, y: 6 } });
  });

  it('keeps the last position of one drag step and does not touch the object it was given', () => {
    const before: SavedPositions = { a: { x: 1, y: 1 } };
    const next = recordPositions(before, [{ id: 'a', type: 'position', position: { x: 2, y: 2 } }, { id: 'a', type: 'position', position: { x: 3, y: 3 } }]);
    expect(next).toEqual({ a: { x: 3, y: 3 } });
    expect(before).toEqual({ a: { x: 1, y: 1 } });
  });

  it('returns the same object when nothing moved', () => {
    const before: SavedPositions = { a: { x: 1, y: 1 } };
    expect(recordPositions(before, [{ id: 'a', type: 'position', position: { x: 1, y: 1 } }])).toBe(before);
    expect(recordPositions(before, [])).toBe(before);
  });
});
