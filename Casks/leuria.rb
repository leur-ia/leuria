cask "leuria" do
  arch arm: "apple-silicon", intel: "intel"

  version "0.1.1"
  sha256 arm:   "df82ea25aaff274239226e0c694a5e4dd03f355cd7b2ec91ebf3b939b8c2ea79",
         intel: "4234f14176beec1ac8702ab1add456682d78352345708acdc9dc7cec59904ddd"

  url "https://github.com/leur-ia/leuria/releases/download/v#{version}/Leuria-mac-#{arch}.dmg"
  name "Leuria"
  desc "Use your own AI on the websites you choose"
  homepage "https://leuria.eu/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Leuria updates itself.
  auto_updates true
  depends_on macos: ">= :big_sur"

  app "Leuria.app"

  uninstall quit:      "eu.leuria.app",
            launchctl: "Leuria",
            delete:    "~/Library/LaunchAgents/Leuria.plist"

  zap trash: [
    "~/.leuria",
    "~/Library/Application Support/eu.leuria.app",
    "~/Library/Caches/eu.leuria.app",
    "~/Library/WebKit/eu.leuria.app",
  ]

  caveats <<~EOS
    Leuria is not signed by Apple yet. The first time you open it, macOS asks
    you to confirm: open System Settings > Privacy & Security and click
    "Open Anyway" next to Leuria.
  EOS
end
