#!/usr/bin/env ruby
# codeowners.rb <CODEOWNERS-file> < changed-files  →  owners.json on stdout
#
# GitHub semantics, approximated with File.fnmatch: the LAST matching rule
# wins; a pattern with a leading "/" or containing "/" is anchored at the repo
# root; a bare name matches at any depth; a trailing "/" means the directory
# and everything in it. "**" crosses directories (FNM_PATHNAME). The
# approximation is stated in the output (`semantics`) so a reader knows this
# is derived, not GitHub's own answer.
require 'json'

file = ARGV[0] or abort "usage: codeowners.rb <CODEOWNERS> < files"
rules = []
File.foreach(file) do |line|
  line = line.sub(/#.*/, '').strip
  next if line.empty?
  pat, *owners = line.split(/\s+/)
  next if owners.empty?
  rules << [pat, owners]
end

def expand(pat)
  # GitHub anchors a pattern at the root when it starts with "/" OR contains
  # a "/" anywhere before a trailing slash; only a bare name floats to any depth.
  anchored = pat.start_with?('/') || pat.chomp('/').include?('/')
  p = pat.sub(%r{\A/}, '')
  p = p + '**' if p.end_with?('/')
  # A pattern with no trailing slash may name a directory, and GitHub then
  # owns everything under it ("/chainctl" covers chainctl/pkg/x.go). Try that
  # reading too. Anchoring is unchanged, so "/README.md" still does not reach
  # sub/dir/README.md.
  bases = p.end_with?('**') ? [p] : [p, "#{p}/**"]
  globs = bases.flat_map { |b| anchored ? [b] : [b, "**/#{b}"] }
  # Under FNM_PATHNAME a trailing "**" only recurses when followed by "/", so
  # "api/**" alone matches api/x.go but not api/sub/x.go. GitHub matches at
  # any depth; "<glob>/*" restores that, and "**/" recursing covers depth >= 3.
  globs.flat_map { |g| g.end_with?('/**') ? [g, "#{g}/*"] : [g] }.uniq
end

paths = {}
$stdin.each_line do |l|
  f = l.strip; next if f.empty?
  hit = nil
  rules.each_with_index do |(pat, owners), i|
    hit = { 'owners' => owners, 'rule' => pat, 'rule_index' => i } if expand(pat).any? { |g| File.fnmatch?(g, f, File::FNM_PATHNAME) }
  end
  paths[f] = hit || { 'owners' => [], 'rule' => nil, 'rule_index' => nil }
end

puts JSON.pretty_generate(
  'source' => file,
  'semantics' => 'last matching rule wins; rules match at any depth; a path with no trailing slash also covers a directory of that name and its contents; File.fnmatch FNM_PATHNAME approximation of GitHub CODEOWNERS',
  'paths' => paths,
  'teams' => paths.values.flat_map { |h| h['owners'] }.uniq.sort
)
