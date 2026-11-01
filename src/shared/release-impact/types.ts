export type RepoRole = "source" | "automation" | "contract";

export type SelectionFormat =
  | "file-list"
  | "playwright-grep"
  | "testng-xml"
  | "cucumber-tags"
  | "junit"
  | "json";

export type TestTier = "must" | "should" | "optional";

export type RepoConfig = {
  id: string;
  path: string;
  role: RepoRole;
  language?: string;
  framework?: string;
  adapterPath?: string;
  testGlobs?: string[];
  caseIdPattern?: string;
  prod?: string;
  candidate?: string;
};

export type MappingRule = {
  match: string;
  tests: string[];
};

export type ContractRule = {
  repo: string;
  type: string;
  path: string;
};

export type ImpactPolicy = {
  fullRegression?: string[];
  minMappingCoverage?: number;
  maxChangedFiles?: number;
  allowCustomAdapters?: boolean;
};

export type ImpactOutputs = {
  report: string;
  selection: string;
  selectionFormat: SelectionFormat;
};

export type ImpactConfig = {
  schemaVersion: number;
  team?: string;
  releaseManifest?: string;
  repos: RepoConfig[];
  ignore?: string[];
  mapping?: {
    explicit?: MappingRule[];
    contracts?: ContractRule[];
  };
  policy?: ImpactPolicy;
  outputs: ImpactOutputs;
  jira?: {
    enabled?: boolean;
    projectKeys?: string[];
  };
};

export type ReleaseRefs = {
  prod: Record<string, string>;
  candidate: Record<string, string>;
};

export type SelectedTest = {
  id: string;
  name: string;
  file: string;
  suite: string;
  reason: string;
  evidence: string[];
};

export type NewScenario = {
  title: string;
  source: string;
  reason: string;
};

export type ImpactRisk = {
  severity: "high" | "medium";
  category: string;
  source: string;
  automation: string;
  action: string;
};

export type SelectedTests = {
  release: ReleaseRefs;
  mustRun: SelectedTest[];
  shouldRun: SelectedTest[];
  optionalRun: SelectedTest[];
  newScenarios: NewScenario[];
  risks: ImpactRisk[];
  fullRegression: boolean;
  fullRegressionReasons: string[];
  unknowns: string[];
  selectionFormat: SelectionFormat;
  selectionText: string;
};

export type ImpactSummary = {
  ok: boolean;
  exitCode: 0 | 2 | 3;
  errors: string[];
  fullRegression: boolean;
  fullRegressionReasons: string[];
  changedFiles: number;
  commits: string[];
  paths: string[];
  mustRun: SelectedTest[];
  mustRunTotal: number;
  shouldRun: SelectedTest[];
  shouldRunTotal: number;
  newScenarios: NewScenario[];
  risks: ImpactRisk[];
  unknowns: string[];
  report: string | null;
  selection: string | null;
  selectionText: string | null;
};
