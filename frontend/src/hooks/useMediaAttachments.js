import { useState, useRef, useCallback } from 'react';

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

export function useMediaAttachments() {
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const addFiles = useCallback(async (filesList) => {
    if (!filesList || filesList.length === 0) return;

    for (const file of filesList) {
      const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const isImage = file.type.startsWith('image/');

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
      } else {
        const base64Data = await readFileAsBase64(file);
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            size: file.size,
            type: 'file',
            mimeType: file.type || 'application/octet-stream',
            data: base64Data,
          },
        ]);
      }
    }
  }, []);

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
