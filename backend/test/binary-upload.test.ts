import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { AttachmentService } from "../src/attachment-service";
import { ProjectManager } from "../src/project-manager";

describe("Direct Binary Media Upload and Attachment Ingestion", () => {
  let tempDir: string;
  let projectDir: string;
  let service: AttachmentService;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "media-upload-test-"));
    projectDir = path.join(tempDir, "sample-project");
    await fs.mkdir(projectDir, { recursive: true });
    service = new AttachmentService();
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("AttachmentService directly ingests pre-uploaded attachments using path without base64 serialization", async () => {
    // 1. Pre-stage a 5MB mock video file directly in .crbn/attachments
    const attDir = path.join(projectDir, ".crbn", "attachments");
    await fs.mkdir(attDir, { recursive: true });
    const videoFileName = "huge-screencast.mp4";
    const videoFilePath = path.join(attDir, videoFileName);
    const mockBinary = Buffer.alloc(1024 * 1024 * 2, 0x41); // 2MB binary
    await fs.writeFile(videoFilePath, mockBinary);

    // 2. Ingest via AttachmentService passing path only (data: undefined)
    const result = await service.processAttachments(
      [
        {
          name: videoFileName,
          path: path.relative(projectDir, videoFilePath),
          size: mockBinary.length,
          mimeType: "video/mp4",
          isVideo: true,
          thumbnailUrl: "data:image/jpeg;base64,/9j/mockthumbnail",
        },
      ],
      projectDir,
    );

    expect(result.savedPaths.length).toBe(1);
    expect(result.savedPaths[0]).toBe(videoFilePath);
    expect(fsSync.existsSync(result.savedPaths[0])).toBe(true);

    // Prompt addition should reference the relative file path
    expect(result.promptAdditions).toContain("huge-screencast.mp4");
    expect(result.promptAdditions).toContain('type="video"');

    // Thumbnail should be forwarded to vision images
    expect(result.images.length).toBe(1);
    expect(result.images[0].type).toBe("image");
    expect(result.images[0].data).toBe("/9j/mockthumbnail");
  });
});
