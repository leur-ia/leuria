cask "leuria" do
  arch arm: "apple-silicon", intel: "intel"

  version "0.1.9"
  sha256 arm:   "4fc2ad1e9cd081defa25bb748d2b26fa8819ceff56eac919d6bb33e1fea3b04d",
         intel: "393d017e82978016823ccccc0cd2c60bd77f69330a0f8fe4a562e65dab9c80a4"

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
