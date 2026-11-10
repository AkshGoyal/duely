import { nanoid } from 'nanoid';

export const newMcpToken = () => nanoid(24);
export const newPayToken = () => nanoid(21);

export function baseUrl(): string {
  const port = Number(process.env.PORT) || 3000;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return (process.env.PUBLIC_BASE_URL || railway || `http://localhost:${port}`).replace(/\/+$/, '');
}
export const payUrl = (payToken: string) => `${baseUrl()}/pay/${payToken}`;
export const editUrl = (id: number) => `${baseUrl()}/invoices/${id}`;
export const mcpUrl = (mcpToken: string) => `${baseUrl()}/mcp/${mcpToken}`;
