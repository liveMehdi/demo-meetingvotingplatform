import { QRCodeSVG } from "qrcode.react";

export function GuestJoinCard({
  code,
  origin = window.location.origin,
}: {
  code: string;
  origin?: string;
}) {
  const link = new URL(`/join#${encodeURIComponent(code)}`, origin);

  const localOnly =
    link.hostname === "localhost" ||
    link.hostname.endsWith(".localhost") ||
    link.hostname.startsWith("127.") ||
    ["[::1]", "0.0.0.0", "[::]"].includes(link.hostname);

  return (
    <div className="space-y-4 surface-inset text-card-foreground">
      <h3 className="text-lg font-semibold">Join this meeting</h3>
      <div className="mx-auto w-fit max-w-full rounded-md bg-white p-2">
        <QRCodeSVG
          value={link.href}
          size={240}
          level="M"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#000000"
          title="Scan to join this meeting"
          role="img"
          className="mx-auto block h-auto max-w-full"
        />
      </div>
      <p className="supporting-copy">
        Enter code{" "}
        <strong className="mt-1 block break-all font-mono text-2xl tracking-wider text-foreground">
          {code}
        </strong>
      </p>
      <label className="block text-sm font-medium">
        Join link
        <input
          aria-label="Meeting join link"
          readOnly
          value={link.href}
          onFocus={(event) => event.target.select()}
          className="mt-2 ui-input"
        />
      </label>
      {localOnly && (
        <p className="text-sm font-medium">
          Preview QR: this address only works on this computer. Phones need a
          reachable website address.
        </p>
      )}
      <p className="supporting-copy">No account required.</p>
    </div>
  );
}
