import { Button, Notice, navigate, useAction } from "@canbadge/ui";
import { useState } from "react";
import { ArchivePostFields } from "./ArchivePostFields";
import { api } from "./api";
import {
  canPost,
  emptyPostForm,
  type PostFormState,
  postedMessage,
  toPostRequest,
} from "./archive-post-logic";
import { clearPublishOffer, readPublishOffer } from "./publish-offer";

/**
 * 注文のあとに出す「みんなの作品として公開しますか（任意）」。注文の確認では聞かず、注文が済んでから聞く。
 * 公開する・公開しないを決めたら、もう出さない。注文画面から来ていない（材料がない）ときは、何も出さない
 */
export function PublishOffer({ orderId }: { orderId: string }) {
  const [offer] = useState(() => readPublishOffer(orderId));
  const [form, setForm] = useState<PostFormState>(emptyPostForm);
  const [done, setDone] = useState<"posted" | "declined" | undefined>(undefined);

  const post = useAction(async () => {
    if (!offer) return;
    await api.call("createArchiveEntry", {
      body: { imageId: offer.imageId, editorData: offer.editorData, ...toPostRequest(form) },
    });
    clearPublishOffer(orderId);
    setDone("posted");
  });

  if (done === "posted")
    return (
      <Notice>
        {postedMessage}
        <br />
        <a
          href="/archive/mine"
          onClick={(event) => {
            event.preventDefault();
            navigate("/archive/mine");
          }}
        >
          自分の投稿を見る
        </a>
      </Notice>
    );
  if (!offer || done === "declined") return null;

  return (
    <section className="cb-publish-offer" aria-label="みんなの作品として公開する">
      <p>
        この作品を、「みんなの作品」として公開しますか（任意）。公開しなくても、注文はそのまま進みます。
      </p>
      <ArchivePostFields value={form} onChange={setForm} disabled={post.running} />
      {post.error && <Notice tone="error">{post.error}</Notice>}
      <div className="cb-publish-offer__actions">
        <Button onClick={() => void post.run()} disabled={!canPost(form) || post.running}>
          {post.running ? "公開しています…" : "公開する"}
        </Button>
        <Button
          variant="line"
          onClick={() => {
            clearPublishOffer(orderId);
            setDone("declined");
          }}
          disabled={post.running}
        >
          公開しない
        </Button>
      </div>
    </section>
  );
}
