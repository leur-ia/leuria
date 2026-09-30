cask "leuria" do
  arch arm: "apple-silicon", intel: "intel"

  version "0.1.4"
  sha256 arm:   "c8ba0ccb4be606b66a0850540aa4d85f138ce71a3f43771f04c64adb2a4f24ed",
         intel: "d1d3589afd39bbf78bc31be9f1f9c50fc1755558fcb6c91f2a5b46be27caa930"

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
