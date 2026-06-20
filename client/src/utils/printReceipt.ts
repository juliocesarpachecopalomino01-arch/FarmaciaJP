import { buildApiUrl } from '../api/client';

async function printPdf(path: string) {
  const token = localStorage.getItem('token');
  const response = await fetch(buildApiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error('No se pudo generar el comprobante');
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.setTimeout(() => {
      iframe.remove();
      window.URL.revokeObjectURL(url);
    }, 500);
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    frameWindow.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(cleanup, 5 * 60 * 1000);

    frameWindow.focus();
    frameWindow.print();
  };

  document.body.appendChild(iframe);
}

export async function printReceipt(saleId: number) {
  return printPdf(`/receipts/${saleId}/pdf`);
}

export async function printInventoryAdjustmentReceipt(movementId: number) {
  return printPdf(`/receipts/inventory-adjustments/${movementId}/pdf`);
}

export async function printInventoryInitialLoadReceipt(referenceNumber: string) {
  return printPdf(`/receipts/inventory-loads/${encodeURIComponent(referenceNumber)}/pdf`);
}
