export type EntityType = "Document" | "Task" | "Record";

export type JobType = "site.discover" | "site.run" | "session.reauth" | "crawl.url";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "reauth_required"
  | "needs_review"
  | "partial_success";

export type ReviewStatus = "approved" | "needs_review";

export type PhaseStatus = "queued" | "running" | "succeeded" | "failed" | "needs_review" | "skipped";

export type CrawlRunStatus = "queued" | "running" | "succeeded" | "failed" | "needs_review" | "partial_success";

export type CrawlPageKind = "seed" | "list" | "detail" | "login" | "oauth-callback" | "other";

export type CrawlLinkDecision = "queued" | "followed" | "skipped" | "blocked" | "duplicate";

export type AuthMode = "auto" | "none" | "form" | "oauth";

export type OtpMode = "totp" | "imap" | "webhook-inbox";

export type CaptchaMode = "2captcha-compatible";

export interface SiteDefinition {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  objective: string;
  entityType: EntityType;
  fieldList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SiteAccount {
  id: string;
  siteId: string;
  label: string;
  authMode: "none" | "basic" | "basic+otp" | "oauth";
  credentials: Record<string, unknown>;
  isDefault: boolean;
}

export interface CrawlOtpConfig {
  mode: OtpMode;
  config: Record<string, unknown>;
}

export interface CrawlCaptchaConfig {
  mode: CaptchaMode;
  config: Record<string, unknown>;
}

export interface CrawlAuthInput {
  mode: AuthMode;
  credentials?: Record<string, unknown>;
  otp?: CrawlOtpConfig;
  captcha?: CrawlCaptchaConfig;
}

export interface CrawlConfig {
  maxDepth: number;
  maxPages: number;
  maxRecords: number;
  sameOriginOnly: boolean;
}

export interface CrawlSinkInput {
  enabled: boolean;
  sinkType?: "echo" | "webhook";
  config?: Record<string, unknown>;
  template?: Record<string, unknown>;
}

export interface CrawlRun {
  id: string;
  siteId: string;
  jobId: string;
  seedUrl: string;
  status: CrawlRunStatus;
  discoveryStatus: PhaseStatus;
  authStatus: PhaseStatus;
  crawlStatus: PhaseStatus;
  deliveryStatus: PhaseStatus | "partial_success";
  entityType?: EntityType;
  confidence: number;
  reviewReason?: string;
  publishedRecipeVersion?: number;
  exportDir?: string;
  authConfig: CrawlAuthInput;
  crawlConfig: CrawlConfig;
  sinkConfig: CrawlSinkInput;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface CrawlExport {
  id: string;
  crawlRunId: string;
  exportType: "records.json" | "records.csv" | "summary.json" | "artifact-index.json";
  path: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CrawlPageRecord {
  id: string;
  crawlRunId: string;
  url: string;
  canonicalUrl: string;
  pageKind: CrawlPageKind;
  depth: number;
  parentUrl?: string;
  status: "queued" | "visited" | "failed";
  title?: string;
  confidence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CrawlLinkRecord {
  id: string;
  crawlRunId: string;
  fromUrl: string;
  toUrl: string;
  anchorText?: string;
  decision: CrawlLinkDecision;
  reason?: string;
  depth: number;
  createdAt: string;
}

export interface ChallengeAttempt {
  id: string;
  crawlRunId: string;
  challengeType: "oauth" | "otp" | "captcha";
  status: "pending" | "succeeded" | "failed" | "needs_review";
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface RecipeField {
  name: string;
  selector: string;
  attr?: string;
  required?: boolean;
  scope?: "item" | "detail";
}

export interface LoginRecipe {
  loginUrl?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  otpSelector?: string;
  successSelector?: string;
  successUrlContains?: string;
}

export interface DiscoveryRecipe {
  listUrl?: string;
  waitForSelector: string;
  listItemSelector: string;
  detailLinkSelector?: string;
  fields: RecipeField[];
}

export interface AutoDiscoveryPageDefinition {
  kind: CrawlPageKind;
  urlPattern?: string;
  pageSelector?: string;
  itemSelector?: string;
  detailLinkSelector?: string;
  paginationSelector?: string;
  titleSelector?: string;
  summarySelector?: string;
  contentSelector?: string;
  confidence: number;
}

export interface AutoDiscoveryNavigationRules {
  sameOriginOnly: boolean;
  maxDepth: number;
  maxPages: number;
  maxRecords: number;
  allowPatterns: string[];
  denyPatterns: string[];
}

export interface AutoDiscoveryAuthStrategy {
  mode: Exclude<AuthMode, "auto">;
  loginUrl?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  otpSelector?: string;
  oauthTriggerTexts?: string[];
  successUrlContains?: string;
}

export interface AutoDiscoveryRecipe {
  entityType: EntityType;
  fields: string[];
  authStrategy: AutoDiscoveryAuthStrategy;
  pageKinds: AutoDiscoveryPageDefinition[];
  navigation: AutoDiscoveryNavigationRules;
  verification: {
    sampleUrls: string[];
    artifacts: string[];
    notes?: string;
  };
}

export interface SourceRecipe {
  version: number;
  connectorType: "generic-recipe" | "url-discovery";
  entryUrl: string;
  authRequired: boolean;
  login?: LoginRecipe;
  discovery?: DiscoveryRecipe;
  normalization?: {
    externalIdField?: string;
    titleField?: string;
  };
  autoDiscovery?: AutoDiscoveryRecipe;
  notes?: string;
}

export interface StoredRecipe {
  id: string;
  siteId: string;
  version: number;
  status: "draft" | "published";
  recipe: SourceRecipe;
  confidence: number;
  aiProvider: string;
  notes?: string;
  createdAt: string;
  publishedAt?: string;
}

export interface SessionState {
  id: string;
  accountId: string;
  status: "new" | "authenticated" | "challenge_required" | "error";
  state: Record<string, unknown>;
  storageStatePath?: string;
  lastAuthenticatedAt?: string;
  expiresAt?: string;
  updatedAt: string;
}

export interface SinkDefinition {
  id: string;
  siteId: string;
  sinkType: "echo" | "webhook";
  config: Record<string, unknown>;
  isDefault: boolean;
}

export interface MappingTemplate {
  id: string;
  sinkId: string;
  entityType: EntityType;
  template: Record<string, unknown>;
}

export interface JobRun {
  id: string;
  siteId?: string;
  jobType: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RawArtifact {
  id: string;
  siteId: string;
  jobId: string;
  artifactType: "html" | "screenshot" | "network";
  artifactKey: string;
  content?: string;
  metadata: Record<string, unknown>;
}

export interface NormalizedEntity {
  id: string;
  siteId: string;
  jobId: string;
  entityType: EntityType;
  externalId: string;
  data: Record<string, unknown>;
  status: ReviewStatus;
  confidence: number;
  reviewNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRun {
  id: string;
  entityId: string;
  sinkId: string;
  jobId?: string;
  status: "queued" | "succeeded" | "failed";
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface DiscoveredFormField {
  selector: string;
  type: string;
  name?: string;
  placeholder?: string;
  autocomplete?: string;
  label?: string;
}

export interface DiscoveredForm {
  selector: string;
  action?: string;
  method: string;
  hasPassword: boolean;
  inputs: DiscoveredFormField[];
}

export interface DiscoveredLink {
  selector: string;
  text: string;
  href: string;
}

export interface RepeatedGroupCandidate {
  parentSelector: string;
  itemSelector: string;
  count: number;
  sampleTexts: string[];
  sampleHrefs: string[];
}

export interface PageHeuristicProfile {
  url: string;
  title: string;
  textExcerpt: string;
  textLength: number;
  htmlExcerpt: string;
  hasPasswordForm: boolean;
  forms: DiscoveredForm[];
  links: DiscoveredLink[];
  repeatedGroups: RepeatedGroupCandidate[];
  candidateContentSelector?: string;
  candidateTitleSelector?: string;
  networkRequests: string[];
}

export interface AIRecipeDraftInput {
  site: SiteDefinition;
  account?: SiteAccount;
}

export interface DiscoveryPlanInput {
  site: SiteDefinition;
  seedUrl: string;
  auth: CrawlAuthInput;
  crawl: CrawlConfig;
  seedProfile: PageHeuristicProfile;
  sampleProfiles: PageHeuristicProfile[];
}

export interface PageClassificationInput {
  recipe: SourceRecipe;
  profile: PageHeuristicProfile;
}

export interface SchemaInferenceInput {
  recipe: SourceRecipe;
  samples: Array<Record<string, unknown>>;
}

export interface EntityInferenceInput {
  seedUrl: string;
  seedProfile: PageHeuristicProfile;
  sampleProfiles: PageHeuristicProfile[];
}

export interface RepairRecipeInput {
  recipe: SourceRecipe;
  failedProfile: PageHeuristicProfile;
  failureReason: string;
}

export interface DiscoveryPlanResult {
  recipe: SourceRecipe;
  confidence: number;
  notes?: string;
}

export interface PageClassificationResult {
  pageKind: CrawlPageKind;
  confidence: number;
  notes?: string;
}

export interface SchemaInferenceResult {
  fields: string[];
  confidence: number;
  notes?: string;
}

export interface EntityInferenceResult {
  entityType: EntityType;
  confidence: number;
  notes?: string;
}

export interface AIProvider {
  name: string;
  draftRecipe(input: AIRecipeDraftInput): Promise<{
    recipe: SourceRecipe;
    confidence: number;
    notes?: string;
  }>;
  planDiscovery(input: DiscoveryPlanInput): Promise<DiscoveryPlanResult>;
  classifyPage(input: PageClassificationInput): Promise<PageClassificationResult>;
  inferSchema(input: SchemaInferenceInput): Promise<SchemaInferenceResult>;
  inferEntityType(input: EntityInferenceInput): Promise<EntityInferenceResult>;
  repairRecipe(input: RepairRecipeInput): Promise<DiscoveryPlanResult>;
}

export interface SourceConnectorRunContext {
  site: SiteDefinition;
  recipe: SourceRecipe;
  account?: SiteAccount;
  session?: SessionState;
}

export interface ExtractedRecord {
  externalId: string;
  data: Record<string, unknown>;
  confidence: number;
  status: ReviewStatus;
  reviewNotes?: string;
}

export interface SourceConnectorRunResult {
  artifacts: Omit<RawArtifact, "id" | "jobId" | "siteId">[];
  records: ExtractedRecord[];
}

export interface SourceConnector {
  type: string;
  run(context: SourceConnectorRunContext): Promise<SourceConnectorRunResult>;
}

export interface SinkConnectorPayload {
  site: SiteDefinition;
  entity: NormalizedEntity;
  sink: SinkDefinition;
  template: MappingTemplate;
}

export interface SinkConnectorResult {
  status: "queued" | "succeeded" | "failed";
  responsePayload: Record<string, unknown>;
  error?: string;
}

export interface SinkConnector {
  type: string;
  test(config: Record<string, unknown>, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  deliver(payload: SinkConnectorPayload): Promise<SinkConnectorResult>;
}
