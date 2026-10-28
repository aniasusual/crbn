import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { AttachmentService } from "../src/attachment-service";

describe("Video Attachments Processing in AttachmentService", () => {
  let tempDir: string;
  let service: AttachmentService;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "video-att-test-"));
    service = new AttachmentService();
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("persists attached video to project workspace and generates prompt addition with thumbnail", async () => {
    // 1x1 transparent png as base64 thumbnail
    const mockThumbnail = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
    const mockVideoData = Buffer.from("mock-video-binary-bytes").toString("base64");

    const result = await service.processAttachments(
      [
        {
          name: "demo-recording.mp4",
          data: mockVideoData,
          size: 24,
          mimeType: "video/mp4",
          isVideo: true,
          thumbnailUrl: mockThumbnail,
        },
      ],
      tempDir,
    );

    // 1. Video must be written to .crbn/attachments in the project
    expect(result.savedPaths.length).toBe(1);
    expect(fsSync.existsSync(result.savedPaths[0])).toBe(true);
    expect(result.savedPaths[0].includes("demo-recording.mp4")).toBe(true);

    // 2. Prompt addition must reference the saved video file
    expect(result.promptAdditions).toContain("demo-recording.mp4");
    expect(result.promptAdditions).toContain('type="video"');

    // 3. Extracted video thumbnail must be forwarded to multimodal vision images
    expect(result.images.length).toBe(1);
    expect(result.images[0].type).toBe("image");
    expect(result.images[0].mimeType).toBe("image/jpeg");
  });

  it("identifies video attachments by file extension even if isVideo flag is not explicit", async () => {
    const mockVideoData = Buffer.from("webm-bytes").toString("base64");

    const result = await service.processAttachments(
      [
        {
          name: "screen-capture.webm",
          data: mockVideoData,
          mimeType: "video/webm",
        },
      ],
      tempDir,
    );

    expect(result.savedPaths.length).toBe(1);
    expect(result.promptAdditions).toContain('type="video"');
    expect(result.promptAdditions).toContain("screen-capture.webm");
  });
});
