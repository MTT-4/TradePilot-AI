import { SiteChatClient } from "./site-chat-client";

export default async function SiteChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SiteChatClient siteId={id} />;
}
