import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface CalendarInput {
  clientName: string;
  month: number;
  year: number;
  platforms: string[];
  postingFrequency: number;
  contentPillars: Array<{ name: string; description: string; postsPerMonth: number }>;
  messagingDirection: string;
  toneRecommendation: string;
  platformStrategy: Record<string, any>;
  keyMessages: string[];
}

/** Compact skeleton — generated in bulk, ~50 tokens each */
export interface PostSkeleton {
  date: string;
  platform: string;
  format: string;
  pillar: string;
  topic: string;
  hook: string;
  hashtags: string[];
  creativeNote: string;
}

export interface CaptionContext {
  clientName: string;
  platform: string;
  format: string;
  pillar: string;
  topic: string;
  hook: string;
  toneRecommendation: string;
  messagingDirection: string;
  keyMessages: string[];
}

/** Full caption generated on-demand per post */
export interface ExpandedCaption {
  caption: string;
  hashtags: string[];
  cta: string;
}

export type ImprovableField = 'hook' | 'caption' | 'cta' | 'hashtags' | 'creativeNote';

export interface ImproveFieldInput {
  field: ImprovableField;
  currentValue: string | string[];
  instruction: string;
  clientName: string;
  platform: string;
  format: string;
  topic: string;
  pillar: string;
  hook: string;
  caption: string;
  toneRecommendation: string;
  messagingDirection: string;
  keyMessages: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractJsonArray(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const i = raw.indexOf('[');
  return i !== -1 ? raw.slice(i) : raw.trim();
}

/**
 * Extract every complete top-level { } object from a possibly-truncated array.
 * Used as a fallback when JSON.parse fails.
 */
function recoverPartialJsonArray(raw: string): any[] {
  const text = extractJsonArray(raw);
  const objects: any[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { objects.push(JSON.parse(text.slice(start, i + 1))); } catch {}
        start = -1;
      }
    }
  }
  return objects;
}

function extractJson(raw: string): any {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1].trim() : raw.trim();
  const start = text.search(/[{[]/);
  return start !== -1 ? JSON.parse(text.slice(start)) : JSON.parse(text);
}

const CALENDAR_SYSTEM = `You are a professional social media content calendar creator for a marketing agency. You output strictly valid JSON — no markdown fences, no preamble, no explanation. Each post must be platform-native, specific, and actionable. Hooks must stop the scroll in under 10 words. Topics must be concrete, not generic.`;

const CAPTION_SYSTEM = `You are a senior social media copywriter. You write platform-native captions that are elevated, specific, and on-brand. You output strictly valid JSON — no markdown fences, no explanation.`;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class CalendarAgentService {
  private readonly logger = new Logger(CalendarAgentService.name);
  private anthropic: Anthropic;
  private model: string;

  constructor(private config: ConfigService) {
    this.anthropic = new Anthropic({ apiKey: config.get<string>('ANTHROPIC_API_KEY') });
    this.model = config.get<string>('ANTHROPIC_CALENDAR_MODEL') || 'claude-haiku-4-5-20251001';
  }

  /**
   * Phase 1 — Compact skeleton calendar.
   * ~50 tokens per post vs ~400 for full content. 75 % cost reduction.
   * Captions are generated on-demand via expandCaption().
   */
  async generate(input: CalendarInput): Promise<PostSkeleton[]> {
    this.logger.log(`Generating calendar skeleton for ${input.clientName} — ${input.month}/${input.year}`);

    const monthName = new Date(input.year, input.month - 1).toLocaleString('en', { month: 'long' });
    const pillars = input.contentPillars.map(p => `${p.name} (${p.postsPerMonth}/mo)`).join(', ');
    const platforms = input.platforms.join(', ');

    const prompt = `Create a ${monthName} ${input.year} content calendar for ${input.clientName}.

Platforms: ${platforms}
Total posts: ${input.postingFrequency}
Pillars: ${pillars}
Tone: ${input.toneRecommendation}

Rules:
- Distribute posts evenly, no two posts on the same day
- Match each post to the correct platform's preferred formats
- Respect each pillar's postsPerMonth count

Return a JSON array only (no markdown). Each object:
{"date":"YYYY-MM-DD","platform":"instagram","format":"reel","pillar":"Pillar Name","topic":"8–12 word topic","hook":"Under 10 words","hashtags":["tag1","tag2","tag3"],"creativeNote":"One sentence visual direction"}

Return exactly ${input.postingFrequency} objects. Start with [ and end with ].`;

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4000,
      temperature: 0.7,
      system: [{ type: 'text', text: CALENDAR_SYSTEM, cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('No text returned from AI');

    const truncated = response.stop_reason === 'max_tokens';
    this.logger.log(
      `Calendar skeleton done. Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}` +
      (truncated ? ' [TRUNCATED]' : ''),
    );

    try {
      const parsed = JSON.parse(extractJsonArray(block.text));
      return Array.isArray(parsed) ? parsed : parsed.posts || [];
    } catch {
      if (truncated) {
        const recovered = recoverPartialJsonArray(block.text);
        if (recovered.length > 0) {
          this.logger.warn(`Recovered ${recovered.length}/${input.postingFrequency} posts from truncated response`);
          return recovered;
        }
      }
      throw new Error(`Failed to parse calendar output: ${block.text.slice(0, 200)}`);
    }
  }

  /**
   * Phase 2 — On-demand full caption for one post.
   * Called when an admin opens a post or clicks "Generate Caption".
   * ~300–400 tokens per call instead of generating all captions upfront.
   */
  async expandCaption(ctx: CaptionContext): Promise<ExpandedCaption> {
    const hashtagCount = ctx.platform === 'instagram' ? '5–8' : ctx.platform === 'linkedin' ? '3–5' : '2–3';

    const prompt = `Write a social media caption for ${ctx.clientName}.

Platform: ${ctx.platform} (${ctx.format})
Content Pillar: ${ctx.pillar}
Topic: ${ctx.topic}
Opening hook (use this verbatim as the first line): "${ctx.hook}"
Tone: ${ctx.toneRecommendation}
Messaging: ${ctx.messagingDirection}
Key messages: ${ctx.keyMessages.slice(0, 3).join(' | ')}

Caption rules:
- Start with the hook above
- Max ${ctx.platform === 'linkedin' ? '180' : '120'} words
- End with a natural, non-pushy CTA
- ${hashtagCount} hashtags, no # in the caption body

Return JSON only:
{"caption":"full caption text","hashtags":["tag1","tag2"],"cta":"the CTA line"}`;

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 600,
      temperature: 0.75,
      system: [{ type: 'text', text: CAPTION_SYSTEM, cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('No caption returned from AI');

    this.logger.log(
      `Caption expanded for "${ctx.topic}". Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`,
    );

    try {
      const parsed = extractJson(block.text);
      return {
        caption:  parsed.caption  || '',
        hashtags: parsed.hashtags || [],
        cta:      parsed.cta      || '',
      };
    } catch {
      throw new Error(`Failed to parse caption response: ${block.text.slice(0, 150)}`);
    }
  }

  /**
   * On-demand improvement of a single post field.
   * Returns a suggestion; the caller decides whether to save it.
   */
  async improveField(ctx: ImproveFieldInput): Promise<{ suggestion: string | string[] }> {
    const instruction = ctx.instruction?.trim() || 'Improve this';
    const hashtagCount = ctx.platform === 'instagram' ? '5–8' : ctx.platform === 'linkedin' ? '3–5' : '2–3';

    const prompts: Record<ImprovableField, string> = {
      hook: `You are a social media copywriter for ${ctx.clientName}.

Post topic: ${ctx.topic}
Platform: ${ctx.platform} (${ctx.format})
Content pillar: ${ctx.pillar}
Tone: ${ctx.toneRecommendation}
Current hook: "${ctx.currentValue}"

Instruction: ${instruction}

Write ONE improved hook. Max 15 words. Punchy, platform-native, makes someone stop scrolling.
Return JSON only: {"suggestion":"the new hook"}`,

      caption: `You are a social media copywriter for ${ctx.clientName}.

Post topic: ${ctx.topic}
Platform: ${ctx.platform} (${ctx.format})
Hook (keep as first line): "${ctx.hook}"
Tone: ${ctx.toneRecommendation}
Messaging: ${ctx.messagingDirection}
Current caption: "${ctx.currentValue}"

Instruction: ${instruction}

Rewrite the caption following the instruction. Keep the hook verbatim as the opening line. Max ${ctx.platform === 'linkedin' ? '180' : '120'} words.
Return JSON only: {"suggestion":"the new caption text"}`,

      cta: `You are a social media copywriter for ${ctx.clientName}.

Post topic: ${ctx.topic}
Platform: ${ctx.platform}
Tone: ${ctx.toneRecommendation}
Current CTA: "${ctx.currentValue}"

Instruction: ${instruction}

Write ONE improved call-to-action. Should feel natural and non-pushy, appropriate for ${ctx.platform}.
Return JSON only: {"suggestion":"the new CTA"}`,

      hashtags: `You are a social media expert for ${ctx.clientName}.

Post topic: ${ctx.topic}
Platform: ${ctx.platform}
Current hashtags: ${(Array.isArray(ctx.currentValue) ? ctx.currentValue : []).map(h => '#' + h).join(' ')}

Instruction: ${instruction}

Generate ${hashtagCount} relevant hashtags. No # prefix in the output values.
Return JSON only: {"suggestion":["tag1","tag2","tag3"]}`,

      creativeNote: `You are a creative director briefing a designer for ${ctx.clientName}.

Post topic: ${ctx.topic}
Platform: ${ctx.platform} (${ctx.format})
Current creative direction: "${ctx.currentValue}"

Instruction: ${instruction}

Write ONE improved creative direction note for the designer. 1–2 sentences max.
Return JSON only: {"suggestion":"the new creative note"}`,
    };

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: ctx.field === 'hashtags' ? 200 : 400,
      temperature: 0.85,
      messages: [{ role: 'user', content: prompts[ctx.field] }],
    });

    const block = response.content.find(b => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('No response from AI');

    this.logger.log(
      `Field "${ctx.field}" improved for "${ctx.topic}". Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`,
    );

    const parsed = extractJson(block.text);
    return { suggestion: parsed.suggestion };
  }
}
