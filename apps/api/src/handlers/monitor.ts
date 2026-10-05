import { getSetting, listReadyOrders } from "@canbadge/db";
import { formatOrderNumber } from "@canbadge/shared";
import type { HandlersFor } from "../register";
import { subscribeSse } from "./sse";

// 呼び出しモニター（処理 PC の localhost）向け。表示専用で、注文 ID（QR の中身）は返さない。

export const monitorHandlers: HandlersFor<"getMonitorReady" | "monitorEvents"> = {
  getMonitorReady: ({ deps }) => {
    const { orderNumberDigits } = getSetting(deps.db.orm);
    return {
      items: listReadyOrders(deps.db).flatMap((order) =>
        order.readyAt
          ? [
              {
                orderNumber: order.orderNumber,
                orderNumberText: formatOrderNumber(order.orderNumber, orderNumberDigits),
                readyAt: order.readyAt,
              },
            ]
          : [],
      ),
    };
  },

  monitorEvents: ({ c, deps }) =>
    subscribeSse(c, deps, (event) => event.type === "monitor.updated"),
};
