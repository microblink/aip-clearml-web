import {cloneDeep} from 'lodash-es';
import {ExtData, ExtFrame} from '@common/shared/single-graph/plotly-graph-base';

export type CompareScalarLegendMode = 'default' | 'appendTags' | 'tagsOnly';

export interface CompareScalarLegendSettings {
  mode: CompareScalarLegendMode;
  /** Comma-separated substrings (OR). Empty = all tags from the pool. */
  tagFilter: string;
  includeSystemTags: boolean;
}

/** Splits `tagFilter` on commas; trims each part; drops empties. */
export function parseScalarLegendTagFilterTerms(tagFilter: string | undefined | null): string[] {
  const raw = (tagFilter ?? '').trim();
  if (!raw) {
    return [];
  }
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export interface GlobalLegendTagRow {
  id: string;
  tags?: string[];
  systemTags?: string[];
}

function collectMatchingTags(
  tags: string[],
  systemTags: string[],
  filterTerms: string[],
  includeSystem: boolean
): string[] {
  const pool: string[] = [...(tags ?? [])];
  if (includeSystem) {
    pool.push(...(systemTags ?? []));
  }
  if (filterTerms.length === 0) {
    return pool;
  }
  return pool.filter(t => {
    const tl = t.toLowerCase();
    return filterTerms.some(term => tl.includes(term.toLowerCase()));
  });
}

/**
 * Returns joined tag string to show in the legend, or null to keep the default trace name
 * (no matching tags when a filter is set, or no tags at all).
 * When `tagFilter` contains commas, each segment is a separate substring; a tag matches if it contains any segment (OR).
 */
export function formatCompareScalarTagSuffix(
  row: GlobalLegendTagRow | undefined,
  settings: CompareScalarLegendSettings
): string | null {
  if (!row || settings.mode === 'default') {
    return null;
  }
  const filterTerms = parseScalarLegendTagFilterTerms(settings.tagFilter);
  const matched = collectMatchingTags(row.tags ?? [], row.systemTags ?? [], filterTerms, settings.includeSystemTags);
  if (filterTerms.length > 0 && matched.length === 0) {
    return null;
  }
  if (matched.length === 0) {
    return null;
  }
  return matched.join(', ');
}

function stableColorKeyForTrace(frame: ExtFrame, trace: ExtData, taskId: string, baseName: string): string {
  const title = frame.layout?.title;
  const titleVariant =
    title && typeof title === 'object' && 'text' in title ? String((title as {text?: string}).text ?? '') : '';
  const variantPart = frame.variant || titleVariant || frame.metric || '';
  return `${frame.metric}|${variantPart}|${baseName}|${taskId}`;
}

function labelTrace(
  trace: ExtData,
  frame: ExtFrame,
  settings: CompareScalarLegendSettings,
  legendByTaskId: Map<string, GlobalLegendTagRow>
): void {
  if (!trace || trace.fakePlot || trace.isSmoothed) {
    return;
  }
  const taskId = trace.task ?? frame.task;
  if (!taskId) {
    return;
  }
  const baseName = trace.name;
  const tagSuffix = formatCompareScalarTagSuffix(legendByTaskId.get(taskId), settings);
  if (settings.mode === 'appendTags') {
    if (tagSuffix) {
      trace.colorKey = trace.colorKey ?? stableColorKeyForTrace(frame, trace, taskId, baseName);
      trace.name = `${baseName} - ${tagSuffix}`;
    }
  } else if (settings.mode === 'tagsOnly' && tagSuffix != null && tagSuffix.length > 0) {
    trace.colorKey = trace.colorKey ?? stableColorKeyForTrace(frame, trace, taskId, baseName);
    trace.name = tagSuffix;
  }
}

export function applyCompareLegendLabels(
  graphs: Record<string, ExtFrame[]>,
  settings: CompareScalarLegendSettings,
  legendByTaskId: Map<string, GlobalLegendTagRow>
): Record<string, ExtFrame[]> {
  if (settings.mode === 'default') {
    return cloneDeep(graphs);
  }
  const out = cloneDeep(graphs);
  for (const frames of Object.values(out)) {
    for (const frame of frames) {
      for (const trace of frame.data) {
        labelTrace(trace, frame, settings, legendByTaskId);
      }
    }
  }
  return out;
}

export function applyCompareLegendLabelsToFrame(
  frame: ExtFrame | null | undefined,
  settings: CompareScalarLegendSettings,
  legendByTaskId: Map<string, GlobalLegendTagRow>
): ExtFrame | null {
  if (!frame) {
    return null;
  }
  if (settings.mode === 'default') {
    return cloneDeep(frame);
  }
  const cloned = cloneDeep(frame);
  for (const trace of cloned.data) {
    labelTrace(trace, cloned, settings, legendByTaskId);
  }
  return cloned;
}

export function buildLegendRowMap(
  rows: GlobalLegendTagRow[] | null | undefined
): Map<string, GlobalLegendTagRow> {
  const map = new Map<string, GlobalLegendTagRow>();
  if (!rows) {
    return map;
  }
  for (const row of rows) {
    if (row?.id) {
      map.set(row.id, row);
    }
  }
  return map;
}

export function toLegendSettingsFromExperimentSettings(settings: {
  scalarLegendMode?: CompareScalarLegendMode;
  scalarLegendTagFilter?: string;
  scalarLegendIncludeSystemTags?: boolean;
}): CompareScalarLegendSettings {
  return {
    mode: settings.scalarLegendMode ?? 'default',
    tagFilter: settings.scalarLegendTagFilter ?? '',
    includeSystemTags: settings.scalarLegendIncludeSystemTags ?? false
  };
}
