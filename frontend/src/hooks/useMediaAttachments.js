import { useState, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';

const MAX_IMAGE_DIMENSION = 2048;

/**
 * Resizes huge images on a canvas so base64 payloads over WebSocket remain fast and responsive.
 */
function downscaleImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result;
      if (!dataUrl || typeof dataUrl !== 'string') {
        resolve(null);
        return;
      }

      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
          const base64 = dataUrl.split(',')[1];
          resolve({ dataUrl, base64, mimeType: file.type || 'image/png' });
          return;
        }

        if (width > height) {
          height = Math.round((height * MAX_IMAGE_DIMENSION) / width);
          width = MAX_IMAGE_DIMENSION;
        } else {
          width = Math.round((width * MAX_IMAGE_DIMENSION) / height);
          height = MAX_IMAGE_DIMENSION;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const base64 = dataUrl.split(',')[1];
          resolve({ dataUrl, base64, mimeType: file.type || 'image/png' });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const mimeType = file.type || 'image/jpeg';
        const resizedDataUrl = canvas.toDataURL(mimeType, 0.9);
        const base64 = resizedDataUrl.split(',')[1];
        resolve({ dataUrl: resizedDataUrl, base64, mimeType });
      };
      img.onerror = () => {
        const base64 = dataUrl.split(',')[1];
        resolve({ dataUrl, base64, mimeType: file.type || 'image/png' });
      };
      img.src = dataUrl;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      } else {
        resolve('');
      }
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}
function captureVideoThumbnail(file) {
  return new Promise((resolve) => {
    let resolved = false;
    let url = '';
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      try {
        URL.revokeObjectURL(url);
        video.remove();
      } catch {}
    };

    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth || 640, 640);
        const scale = canvas.width / (video.videoWidth || 640);
        canvas.height = Math.round((video.videoHeight || 360) * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.85);
          cleanup();
          resolve(thumbnailUrl);
          return;
        }
      } catch {}
      cleanup();
      resolve(null);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    // Fallback safety timeout if video metadata never seeks
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 2500);
  });
}

async function uploadAttachmentBinary(file, projectName) {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (projectName) {
      formData.append('project', projectName);
    }
    const endpoint = projectName
      ? `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/attachments/upload`
      : `${API_BASE_URL}/api/attachments/upload`;

    const res = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[useMediaAttachments] Direct upload failed, falling back to base64:', err);
    return null;
  }
}

export function useMediaAttachments(projectName = '') {
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const addFiles = useCallback(async (filesList, projectOverride = '') => {
    if (!filesList || filesList.length === 0) return;
    const activeProject = projectOverride || projectName;

    for (const file of filesList) {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
      if (isImage) {
        const processed = await downscaleImage(file);
        if (processed) {
          setAttachments((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              size: file.size,
              type: 'image',
              mimeType: processed.mimeType,
              dataUrl: processed.dataUrl,
              base64: processed.base64,
              data: processed.base64,
            },
          ]);
        }
      } else if (isVideo) {
        // Capture lightweight 10KB canvas thumbnail for instant visual display
        const thumbnailUrl = await captureVideoThumbnail(file);

        // Upload binary file directly via HTTP stream (zero WebSocket 16MB ceiling / zero memory freeze)
        const uploadResult = await uploadAttachmentBinary(file, activeProject);

        let base64Data = '';
        if (!uploadResult?.path) {
          base64Data = await readFileAsBase64(file);
        }

        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            type: 'video',
            mimeType: file.type || 'video/mp4',
            thumbnailUrl: thumbnailUrl || undefined,
            dataUrl: thumbnailUrl || undefined,
            path: uploadResult?.path,
            savedPath: uploadResult?.path,
            base64: base64Data || undefined,
            data: base64Data || undefined,
          },
        ]);
      } else {
        let savedPath = null;
        let base64Data = '';

        // For files >= 2MB, stream upload directly to avoid base64 ballooning
        if (file.size >= 2 * 1024 * 1024) {
          const uploadResult = await uploadAttachmentBinary(file, activeProject);
          savedPath = uploadResult?.path || null;
        }

        if (!savedPath) {
          base64Data = await readFileAsBase64(file);
        }

        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            type: 'file',
            mimeType: file.type || 'application/octet-stream',
            path: savedPath || undefined,
            savedPath: savedPath || undefined,
            data: base64Data || undefined,
          },
        ]);
      }
    }
  }, [projectName]);
  const removeAttachment = useCallback((id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addFiles(Array.from(e.dataTransfer.files));
      }
    },
    [addFiles]
  );

  const handlePaste = useCallback(
    (e) => {
      if (!e.clipboardData) return;
      const items = e.clipboardData.items;
      if (!items) return;

      const filesToUpload = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            filesToUpload.push(file);
          }
        }
      }
      if (filesToUpload.length > 0) {
        addFiles(filesToUpload);
      }
    },
    [addFiles]
  );

  return {
    attachments,
    isDragging,
    fileInputRef,
    openFilePicker,
    removeAttachment,
    clearAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    addFiles,
  };
}
