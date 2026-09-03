import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Aideep_backend/src/upload/s3.service.ts 의 축소 사본입니다.
 * 실시간 서버는 FileAttachmentService가 쓰는 URL 변환 2개만 필요하므로
 * 업로드/삭제와 AWS SDK 의존성은 제외했습니다.
 */
@Injectable()
export class S3Service {
  private readonly bucket: string;
  private readonly region: string;

  constructor(private readonly config: ConfigService) {
    this.region = this.config.getOrThrow<string>('AWS_REGION');
    this.bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET');
  }

  getPublicUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * URL에서 S3 key를 추출합니다.
   */
  extractKeyFromUrl(url: string): string {
    const bucketUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/`;
    if (!url.startsWith(bucketUrl)) {
      throw new Error(`Invalid S3 URL format: ${url}`);
    }
    return url.slice(bucketUrl.length);
  }
}
