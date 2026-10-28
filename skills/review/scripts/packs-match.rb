#!/usr/bin/env ruby
# packs-match.rb <packs.yaml> [<site.yaml> ...] < changed-files  →  packs.json
#
# Later files win per pack NAME (a site file can replace a generic pack whole;
# it cannot partially merge one, which keeps "what ran" readable from one
# file). Output lists every pack (`all`) and the matched subset (`matched`)
# with the glob→file pairs that matched, so the manifest can say why a pack
# ran. `only: true` packs match only when every changed file matches.
require 'yaml'
require 'json'

abort "usage: packs-match.rb <packs.yaml> [more.yaml...] < files" if ARGV.empty?
packs = {}
ARGV.each do |f|
  doc = YAML.safe_load(File.read(f)) || {}
  (doc['packs'] || {}).each do |name, body|
    packs[name] = (body || {}).merge('name' => name, 'source' => f)
  end
end
files = $stdin.read.split("\n").map(&:strip).reject(&:empty?)

# Under FNM_PATHNAME a trailing "**" only recurses when followed by "/", so
# "env/**" alone would miss env/prod/main.tf. Pack authors write the trailing
# form; match it as they mean it while reporting the glob they wrote.
def variants(glob)
  glob.end_with?('/**') ? [glob, "#{glob}/*"] : [glob]
end

def hits(pack, files)
  globs = Array(pack['match'])
  files.flat_map do |f|
    globs.select { |g| variants(g).any? { |v| File.fnmatch?(v, f, File::FNM_PATHNAME) } }
         .map { |g| { 'glob' => g, 'file' => f } }
  end
end

matched = packs.values.select do |p|
  h = hits(p, files)
  next false if h.empty?
  p['only'] ? h.map { |x| x['file'] }.uniq.size == files.size : true
end.map { |p| p.merge('by' => hits(p, files)) }

puts JSON.pretty_generate('files' => files, 'all' => packs.values, 'matched' => matched)
