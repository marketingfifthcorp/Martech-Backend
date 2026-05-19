import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class AssetsService implements OnModuleInit {
  private supabase;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {
    this.supabase = createClient(
      config.get('SUPABASE_URL'),
      config.get('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async onModuleInit() {
    const { data } = await this.supabase.storage.getBucket('creatives');
    if (!data) {
      await this.supabase.storage.createBucket('creatives', {
        public: true,
        fileSizeLimit: 209715200, // 200 MB
      });
    }
  }

  async uploadCreative(
    postId: string,
    file: Express.Multer.File,
    uploadedById: string,
    notes?: string,
  ) {
    // Mark previous version as not current
    await this.prisma.asset.updateMany({
      where: { postId, isCurrent: true },
      data: { isCurrent: false },
    });

    const latestVersion = await this.prisma.asset.count({ where: { postId } });
    const ext = file.originalname.split('.').pop();
    const path = `posts/${postId}/v${latestVersion + 1}.${ext}`;

    const { error } = await this.supabase.storage
      .from('creatives')
      .upload(path, file.buffer, { contentType: file.mimetype });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    const { data: urlData } = this.supabase.storage.from('creatives').getPublicUrl(path);

    const asset = await this.prisma.asset.create({
      data: {
        postId,
        uploadedById,
        fileUrl: urlData.publicUrl,
        fileType: file.mimetype.startsWith('video') ? 'video' : 'image',
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        version: latestVersion + 1,
        isCurrent: true,
        notes,
      },
    });

    // Update post status to AWAITING_APPROVAL
    const updatedPost = await this.prisma.post.update({
      where: { id: postId },
      data: { status: 'AWAITING_APPROVAL' },
      include: { project: { include: { client: true } } },
    });

    await this.notifications.notifyAdmins({
      type: 'approval_needed',
      title: 'Creative Uploaded',
      message: `New creative ready for "${updatedPost.topic ?? postId}" — awaiting client approval`,
      link: `/post-review?postId=${postId}`,
    });

    return asset;
  }

  async findByPost(postId: string) {
    return this.prisma.asset.findMany({
      where: { postId },
      orderBy: [{ isCurrent: 'desc' }, { version: 'desc' }],
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
  }

  async deleteAsset(id: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');

    // Extract path from URL
    const url = new URL(asset.fileUrl);
    const path = url.pathname.split('/object/public/creatives/')[1];
    if (path) {
      await this.supabase.storage.from('creatives').remove([path]);
    }

    return this.prisma.asset.delete({ where: { id } });
  }
}
