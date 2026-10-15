/** Methods injected by android/.../Host.java with addJavascriptInterface. Each returns "ok:<info>" or "error:<message>". */
interface AndroidHost {
  saveFile(name: string, mime: string, base64: string): string;
  shareFile(name: string, mime: string, base64: string): string;
}

declare global {
  interface Window {
    DocScanHost?: AndroidHost;
    /** Called by the Android back button; returns true when the app handled it. */
    __docscanBack?: () => boolean;
  }
}

const host = window.DocScanHost;

export const isAndroid = !!host;
export const canShare = isAndroid;

/** Saves a file: Android writes to Downloads/DocScan, desktop shows the save dialog. Returns a status message. */
export async function saveBlob(blob: Blob, name: string): Promise<string> {
  if (host) return result(host.saveFile(name, blob.type, await toBase64(blob)), `Saved to Downloads/DocScan/${name}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return `Exported ${name}`;
}

export async function shareBlob(blob: Blob, name: string): Promise<string> {
  if (!host) throw new Error('Sharing is not available on this device');
  return result(host.shareFile(name, blob.type, await toBase64(blob)), 'Shared');
}

function result(reply: string, okMessage: string): string {
  if (reply.startsWith('error:')) throw new Error(reply.slice(6));
  return okMessage;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
