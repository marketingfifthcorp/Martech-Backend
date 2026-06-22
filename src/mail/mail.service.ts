import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Role } from '@prisma/client';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Super Admin',
  DESIGNER: 'Designer',
  CLIENT: 'Account Manager',
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendInvite(email: string, role: Role) {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const fromName = this.config.get<string>('SMTP_FROM_NAME') ?? 'Martech';
    const fromEmail = this.config.get<string>('SMTP_USER') ?? '';
    const roleLabel = ROLE_LABEL[role] ?? role;
    const signUpUrl = `${frontendUrl}/sign-up`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You've been invited</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Inter',system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">

          <!-- Header -->
          <tr>
            <td style="background:#09090b;padding:28px 36px;">
              <span style="font-size:16px;font-weight:600;color:#ffffff;letter-spacing:-0.3px;">Martech</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#09090b;letter-spacing:-0.4px;">You've been invited</p>
              <p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.6;">
                You've been added to the team as <strong style="color:#09090b;font-weight:500;">${roleLabel}</strong>.
                Click the button below to create your account and get started.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#09090b;border-radius:8px;">
                    <a href="${signUpUrl}" target="_blank"
                       style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;letter-spacing:-0.2px;">
                      Accept invitation →
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 4px;font-size:12px;color:#a1a1aa;">Or copy this link into your browser:</p>
              <p style="margin:0;font-size:12px;color:#3b82f6;word-break:break-all;">${signUpUrl}</p>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="padding:0 36px;"><hr style="border:none;border-top:1px solid #f4f4f5;margin:0;" /></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;font-size:11px;color:#a1a1aa;line-height:1.6;">
              You received this email because an admin added you to their Martech workspace.
              If you weren't expecting this, you can safely ignore it.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    await this.transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: `You've been invited to Martech as ${roleLabel}`,
      html,
    });

    this.logger.log(`Invite email sent to ${email} (${role})`);
  }
}
