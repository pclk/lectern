// Library format written by the lecture-exam-prep skill (scripts/export_lectern.py). All times are seconds of the
// ORIGINAL recording ("source time"), so links, chapters and examples stay valid whatever the player settings are.

/** [start, end, text] */
export type Word = [number, number, string];
export type Range = [number, number];

export type CutCategory = "dead-time" | "break" | "admin" | "technical" | "off-topic" | "not-examinable";

export interface Cut {
  start: number;
  end: number;
  reason: string;
  category: CutCategory;
}

export interface Chapter {
  start: number;
  title: string;
}

export interface Example {
  id: string;
  label: string;
  ref: string | null;
  kind: string;
  start: number;
  end: number;
  summary?: string;
}

export interface SourceSummary {
  id: string;
  module: string;
  title: string;
  label: string;
  kind: string;
  order: number;
  duration: number;
  /** Speed-up the condensing pipeline chose for ~250 wpm with every cut and pause skipped. */
  factor: number;
  wordCount: number;
  chapterCount: number;
  exampleCount: number;
  /** Minutes at default settings (cuts + pauses skipped, auto speed). */
  condensedMinutes: number;
  /** False until chapters and worked examples have been indexed for this recording. */
  indexed: boolean;
}

export interface Source extends SourceSummary {
  /** Heights of the lower-quality copies available (added by the server), highest first. */
  tiers?: number[];
  words: Word[];
  cuts: Cut[];
  /** Removable portions of pauses (each already leaves a short natural pause around it). */
  pauses: Range[];
  chapters: Chapter[];
  examples: Example[];
}

export interface Module {
  code: string;
  title: string;
  sources: SourceSummary[];
  packs: { file: string; title: string }[];
}

export interface Library {
  modules: Module[];
}

export interface SearchHit {
  module: string;
  source: string;
  sourceTitle: string;
  start: number;
  text: string;
}

export interface ExampleHit extends Example {
  module: string;
  source: string;
  sourceTitle: string;
  sourceLabel: string;
}
