import type { Metadata } from "next";
import { LegalDoc } from "@/app/legal-doc";

export const metadata: Metadata = { title: "特定商取引法に基づく表記 | YUKI AI" };

const ROWS: [string, string][] = [
  ["販売事業者", "[運営者名]"],
  ["運営責任者", "[氏名]"],
  ["所在地", "[住所](請求があれば遅滞なく開示します)"],
  ["電話番号", "[電話番号](請求があれば遅滞なく開示します)"],
  ["メールアドレス", "[メールアドレス]"],
  ["販売価格", "各プランの月額料金(税込)は、プランのページに表示します"],
  ["商品代金以外の必要料金", "インターネット接続料金・通信料金は利用者の負担です"],
  ["支払方法", "クレジットカード(Stripe)"],
  ["支払時期", "申し込み時に初月分、以後は毎月の更新日に自動で請求します"],
  ["提供時期", "決済の完了後、すぐに利用できます"],
  ["解約", "プランのページからいつでも解約できます。解約後も、支払済みの期間の終わりまで利用できます"],
  ["返金", "サービスの性質上、支払済みの料金は返金しません。ただし、運営者の責任でサービスを提供できなかった場合は、個別に対応します"],
  ["動作環境", "最新版の Chrome・Safari・Edge。声の会話にはマイクが必要です"],
];

export default function LegalPage() {
  return (
    <LegalDoc title="特定商取引法に基づく表記" updated="2026-11-06">
      <div className="table-wrap">
        <table>
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k}>
                <th scope="row" style={{ whiteSpace: "nowrap", textAlign: "left", verticalAlign: "top" }}>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LegalDoc>
  );
}
