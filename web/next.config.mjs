/** @type {import('next').NextConfig} */
export default {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  // This folder is its own project, even though a parent folder has a lockfile of its own.
  turbopack: { root: import.meta.dirname },
};
