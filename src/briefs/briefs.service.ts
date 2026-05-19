import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';

const BUCKETS = ['briefs', 'brand-assets'] as const;

@Injectable()
export class BriefsService implements OnModuleInit {
  private readonly logger = new Logger(BriefsService.name);
  private supabase;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL'),
      config.get('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async onModuleInit() {
    for (const bucket of BUCKETS) {
      const { data: existing } = await this.supabase.storage.getBucket(bucket);
      if (!existing) {
        const { error } = await this.supabase.storage.createBucket(bucket, {
          public: true,
          fileSizeLimit: 52428800, // 50 MB
        });
        if (error) {
          this.logger.warn(`Could not create bucket "${bucket}": ${error.message}`);
        } else {
          this.logger.log(`Created storage bucket: ${bucket}`);
        }
      }
    }
  }

  async create(dto: CreateBriefDto) {
    // Update client status
    await this.prisma.client.update({
      where: { id: dto.clientId },
      data: { status: 'BRIEF_UPLOADED' },
    });

    return this.prisma.brief.create({ data: dto });
  }

  async findByClient(clientId: string) {
    return this.prisma.brief.findMany({
      where: { clientId },
      include: { strategies: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const brief = await this.prisma.brief.findUnique({
      where: { id },
      include: { strategies: true, client: true },
    });
    if (!brief) throw new NotFoundException('Brief not found');
    return brief;
  }

  async update(id: string, dto: Partial<CreateBriefDto>) {
    return this.prisma.brief.update({ where: { id }, data: dto });
  }

  /**
   * Upload a file to Supabase Storage and attach its URL to the brief.
   * bucket: 'briefs' | 'brand-assets'
   */
  async uploadFile(
    briefId: string,
    file: Express.Multer.File,
    bucket: 'briefs' | 'brand-assets',
  ) {
    const ext = file.originalname.split('.').pop();
    const path = `${briefId}/${Date.now()}.${ext}`;

    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    const { data: urlData } = this.supabase.storage.from(bucket).getPublicUrl(path);
    const url = urlData.publicUrl;

    if (bucket === 'briefs') {
      await this.prisma.brief.update({
        where: { id: briefId },
        data: { briefFileUrl: url, briefFileName: file.originalname },
      });
    } else {
      const brief = await this.prisma.brief.findUnique({ where: { id: briefId } });
      await this.prisma.brief.update({
        where: { id: briefId },
        data: { brandAssets: [...(brief.brandAssets || []), url] },
      });
    }

    return { url, path };
  }
}
