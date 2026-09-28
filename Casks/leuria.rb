cask "leuria" do
  arch arm: "apple-silicon", intel: "intel"

  version "0.1.0"
  sha256 arm:   "dde263ba82d755454723f1289407a4cde99c7d4daebcc99cadd3b22d47695056",
         intel: "0421f35cbb5d98cbb765888dd5ec140a1f92f85cbd294a23461a208425515aa6"

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
