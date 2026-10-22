import { ApiClientError } from "@canbadge/api-client";
import {
  BackButton,
  Button,
  isCompleteCode,
  Notice,
  navigate,
  normalizeConfirmationCode,
  TextField,
  useAction,
} from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";
import { lookupErrorMessage, parseLookupInput } from "./lookup-logic";
import { MyOrders } from "./MyOrders";
import "./lookup.css";

/**
 * 注文照会。スマホを変えた・画面を閉じてしまった人が、注文番号と確認コードで、自分の注文の状況ページを開く。
 * 照合は api が行い、番号と確認コードのどちらが違うかは、教えない（総当たりの手がかりにさせない）
 */
export function LookupPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    orderNumber?: string;
    confirmationCode?: string;
  }>({});

  const lookup = useAction(async () => {
    const input = parseLookupInput(orderNumber, code);
    if (!input.ok) {
      setFieldErrors(input.errors);
      return;
    }
    setFieldErrors({});
    try {
      const { orderId } = await api.call("lookupOrder", {
        body: { orderNumber: input.orderNumber, confirmationCode: input.confirmationCode },
      });
      navigate(`/orders/${orderId}`);
    } catch (error) {
      // 画面に出すのは、してほしいことつきの文（api の内部の言い方は、そのまま出さない）
      if (error instanceof ApiClientError) {
        throw new Error(lookupErrorMessage({ code: error.code, message: error.message }));
      }
      throw error;
    }
  });

  return (
    <main className="cb-page cb-lookup">
      <BackButton className="cb-back--page" onClick={() => navigate("/")} />
      <h1>自分の注文を確認する</h1>
      {/* この端末で注文したなら、番号を入れなくても、ここから開ける */}
      <MyOrders />
      <p>
        スマホを変えた・画面を閉じてしまった方は、注文のあとに出た「注文番号」と「確認コード」で、注文の状況を開けます。
      </p>

      <form
        className="cb-lookup__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void lookup.run();
        }}
      >
        <TextField
          numeric
          label="注文番号"
          hint={fieldErrors.orderNumber ?? "例：017（今日の注文の番号です）"}
          value={orderNumber}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={fieldErrors.orderNumber ? true : undefined}
          onChange={(event) => setOrderNumber(event.target.value)}
        />
        <div className="cb-lookup__code">
          <TextField
            numeric
            label="確認コード（4 文字）"
            hint={
              fieldErrors.confirmationCode ?? "英語の大文字と数字の 4 文字。小文字でも大丈夫です"
            }
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldErrors.confirmationCode ? true : undefined}
            onChange={(event) => setCode(normalizeConfirmationCode(event.target.value))}
          />
        </div>

        {lookup.error && <Notice tone="error">{lookup.error}</Notice>}
        <Button
          type="submit"
          size="large"
          block
          disabled={lookup.running || orderNumber.trim() === "" || !isCompleteCode(code)}
        >
          {lookup.running ? "探しています…" : "注文を開く"}
        </Button>
      </form>

      <p className="cb-muted cb-gap-top">
        番号や確認コードがわからないときは、ブースのスタッフにお声がけください。
      </p>
    </main>
  );
}
