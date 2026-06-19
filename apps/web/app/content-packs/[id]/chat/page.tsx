import { ContentPackChatClient } from "./content-pack-chat-client";

export default async function ContentPackChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <ContentPackChatClient packId={id} />;
}
