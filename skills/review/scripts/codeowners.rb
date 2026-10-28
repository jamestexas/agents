#!/usr/bin/env ruby
# codeowners.rb <CODEOWNERS-file> < changed-files  →  owners.json on stdout
#
# GitHub semantics, approximated with File.fnmatch: the LAST matching rule
# wins; a pattern with a leading "/" is anchored at the repo root; one without
# matches at any depth; a trailing "/" means the directory and everything in
# it. "**" crosses directories (FNM_PATHNAME). The approximation is stated in
# the output (`semantics`) so a reader knows this is derived, not GitHub's
# own answer.
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
  anchored = pat.start_with?('/')
  p = pat.sub(%r{\A/}, '')
  p = p + '**' if p.end_with?('/')
  globs = anchored ? [p] : [p, "**/#{p}"]
  globs.flat_map { |g| g.include?('/') ? [g] : [g, "**/#{g}"] }.uniq
end

paths = {}
$stdin.each_line do |l|
  f = l.strip; next if f.empty?
  hit = nil
  rules.each_with_index do |(pat, owners), i|
    hit = { 'owners' => owners, 'rule' => pat, 'line' => i } if expand(pat).any? { |g| File.fnmatch?(g, f, File::FNM_PATHNAME) }
  end
  paths[f] = hit || { 'owners' => [], 'rule' => nil, 'line' => nil }
end

puts JSON.pretty_generate(
  'source' => file,
  'semantics' => 'last matching rule wins; File.fnmatch FNM_PATHNAME approximation of GitHub CODEOWNERS',
  'paths' => paths,
  'teams' => paths.values.flat_map { |h| h['owners'] }.uniq.sort
)
