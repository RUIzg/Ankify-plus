import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

// 图片处理工具类
export class ImageUtils {
  // 解析Markdown图片路径
  parseImagePath(text: string): string | null {
    // 匹配 Markdown 图片格式: ![alt](path)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/;
    const match = text.match(imageRegex);
    return match ? match[2] : null;
  }

  // 读取图片并转换为base64
  async readImageAsBase64(imagePath: string, currentFilePath: string): Promise<{ base64: string, actualPath: string }> {
    try {
      // 处理相对路径
      let actualPath: string;
      if (imagePath.startsWith("http://") || imagePath.startsWith("https://")) {
        // 网络图片，直接返回（后续会通过API处理）
        return { base64: imagePath, actualPath: imagePath };
      } else if (imagePath.startsWith("/") || imagePath.startsWith("\\")) {
        // 绝对路径
        actualPath = imagePath;
      } else {
        // 相对路径，基于当前文件所在目录
        const currentDir = path.dirname(currentFilePath);
        actualPath = path.join(currentDir, imagePath);
      }

      // 检查文件是否存在
      if (!fs.existsSync(actualPath)) {
        throw new Error(`图片文件不存在: ${actualPath}`);
      }

      // 读取文件内容
      const imageBuffer = fs.readFileSync(actualPath);
      
      // 压缩图片
      const compressedBuffer = await this.compressImage(imageBuffer);
      
      // 转换为base64
      const base64 = this.arrayBufferToBase64(compressedBuffer);
      const mimeType = this.getMimeType(actualPath);
      
      return {
        base64: `data:${mimeType};base64,${base64}`,
        actualPath
      };
    } catch (error) {
      console.error("读取图片失败:", error);
      throw error;
    }
  }

  // 将ArrayBuffer转换为base64
  arrayBufferToBase64(buffer: Buffer): string {
    return buffer.toString("base64");
  }

  // 获取图片的MIME类型
  getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".png":
        return "image/png";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      default:
        return "image/jpeg";
    }
  }

  // 压缩图片
  async compressImage(imageBuffer: Buffer, maxSize = 1024 * 1024): Promise<Buffer> {
    try {
      // 检查当前大小
      if (imageBuffer.length <= maxSize) {
        return imageBuffer;
      }

      // 开始压缩
      let compressedBuffer = imageBuffer;
      let quality = 80;

      while (compressedBuffer.length > maxSize && quality > 10) {
        compressedBuffer = await sharp(compressedBuffer)
          .jpeg({ quality })
          .toBuffer();
        quality -= 10;
      }

      return compressedBuffer;
    } catch (error) {
      console.error("压缩图片失败:", error);
      // 如果压缩失败，返回原始图片
      return imageBuffer;
    }
  }
}
