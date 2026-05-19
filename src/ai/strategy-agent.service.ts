import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface StrategyInput {
  clientName: string;
  brand?: string;
  industry?: string;
  platforms: string[];
  postingFrequency: number;
  websiteUrl?: string;
  socialLinks?: string[];
  campaignGoals?: string;
  targetAudience?: string;
  competitorNotes?: string;
  toneOfVoice?: string;
  sector?: string;
  adminNotes?: string;
  // Fifth methodology injected at runtime
  fifthFramework?: string;
}

export interface StrategyOutput {
  summary: string;
  contentPillars: Array<{
    name: string;
    description: string;
    postsPerMonth: number;
    rationale: string;
  }>;
  targetAudience: {
    demographics: string;
    psychographics: string;
    painPoints: string[];
    desirePoints: string[];
  };
  messagingDirection: string;
  toneRecommendation: string;
  platformStrategy: Record<string, {
    format: string[];
    frequency: number;
    bestTimes: string[];
    contentMix: string;
  }>;
  keyMessages: string[];
}

const FIFTH_SYSTEM_PROMPT = `You are the Strategy Engine for Atelier Martech — an AI-powered marketing platform built by a boutique agency called Fifth Corp.

Your role: generate precise, agency-quality social media marketing strategies. You follow a specific methodology:

FIFTH METHODOLOGY:
1. RESEARCH FIRST — Analyse the client's industry, competitor gaps, and audience intent before proposing any content direction.
2. PILLAR ARCHITECTURE — Every strategy must be built around 3–6 content pillars. Each pillar must have a clear purpose (authority, community, product, storytelling, educational).
3. PLATFORM-NATIVE — Recommend formats native to each platform. Do not suggest the same content format across all platforms.
4. TONAL PRECISION — Match the brand's voice. Never use generic marketing language. Elevated, editorial, precise.
5. MEASURABLE DIRECTION — Every pillar must connect to a business objective (awareness, leads, retention, authority).

OUTPUT FORMAT: Always return valid JSON only — no markdown fences, no extra text, no explanation. Start your response with { and end with }.`;

/** Strip optional markdown code fences from model output */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    return raw.slice(firstBrace);
  }
  if (firstBracket !== -1) return raw.slice(firstBracket);
  return raw.trim();
}

@Injectable()
export class StrategyAgentService {
  private readonly logger = new Logger(StrategyAgentService.name);
  private anthropic: Anthropic;

  constructor(private config: ConfigService) {
    this.anthropic = new Anthropic({
      apiKey: config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async generate(input: StrategyInput): Promise<StrategyOutput> {
    this.logger.log(`Generating strategy for: ${input.clientName}`);

    const userPrompt = `
Generate a complete social media strategy for the following client:

CLIENT: ${input.clientName}${input.brand ? ` / Brand: ${input.brand}` : ''}
INDUSTRY / SECTOR: ${input.industry || input.sector || 'Not specified'}
PLATFORMS: ${input.platforms.join(', ')}
POSTING FREQUENCY: ${input.postingFrequency} posts/month
WEBSITE: ${input.websiteUrl || 'Not provided'}
SOCIAL LINKS: ${input.socialLinks?.join(', ') || 'Not provided'}

CAMPAIGN GOALS: ${input.campaignGoals || 'Not specified'}
TARGET AUDIENCE (admin input): ${input.targetAudience || 'Not specified'}
TONE OF VOICE: ${input.toneOfVoice || 'Not specified'}
COMPETITOR NOTES: ${input.competitorNotes || 'Not provided'}
ADMIN NOTES: ${input.adminNotes || 'None'}

${input.fifthFramework ? `AGENCY FRAMEWORK NOTES:\n${input.fifthFramework}` : ''}

Return a JSON object with this exact schema:
{
  "summary": "2–3 sentence overview of the strategic direction",
  "contentPillars": [
    {
      "name": "Pillar name",
      "description": "What this pillar covers and why",
      "postsPerMonth": number,
      "rationale": "Business objective this serves"
    }
  ],
  "targetAudience": {
    "demographics": "Age, location, income, job title breakdown",
    "psychographics": "Values, lifestyle, mindset",
    "painPoints": ["pain1", "pain2"],
    "desirePoints": ["desire1", "desire2"]
  },
  "messagingDirection": "Core messaging framework — what should every piece of content communicate?",
  "toneRecommendation": "Specific tone description",
  "platformStrategy": {
    "instagram": {
      "format": ["reel", "carousel"],
      "frequency": number,
      "bestTimes": ["9am", "6pm"],
      "contentMix": "Description of content mix"
    }
  },
  "keyMessages": ["message1", "message2", "message3"]
}

Total postsPerMonth across all pillars must equal ${input.postingFrequency}.
Only include platforms from: ${input.platforms.join(', ')}.
Return ONLY the JSON object — no markdown, no preamble, no explanation.
`;

    const response = await this.anthropic.messages.create({
      model: this.config.get<string>('ANTHROPIC_STRATEGY_MODEL') || 'claude-sonnet-4-6',
      max_tokens: 3000,
      temperature: 0.7,
      system: [{ type: 'text', text: FIFTH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as any,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text content returned from Claude');
    }

    this.logger.log(
      `Strategy generation complete. Tokens — in: ${response.usage.input_tokens}, out: ${response.usage.output_tokens}`,
    );

    try {
      return JSON.parse(extractJson(textBlock.text)) as StrategyOutput;
    } catch {
      throw new Error(`Failed to parse strategy output: ${textBlock.text.slice(0, 300)}`);
    }
  }
}
