// core/: pure logic, no Chrome API access. Injected data only.

export interface WindowSummaryInput {
  id: number;
  tabCount: number;
}

export interface Summary {
  windows: number;
  tabs: number;
}

export function summarize(windows: readonly WindowSummaryInput[]): Summary {
  return {
    windows: windows.length,
    tabs: windows.reduce((n, w) => n + w.tabCount, 0),
  };
}
