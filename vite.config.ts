import react from "@vitejs/plugin-react-swc";
import externalGlobals from "rollup-plugin-external-globals";
import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  return {
    define: {
      "process.env": {
        NODE_ENV: JSON.stringify(
          command === "build" ? "production" : "development"
        ),
      },
    },
    build: {
      lib: {
        entry: "src/main.ts",
        fileName: "index",
        formats: ["es"],
      },
      rollupOptions: {
        external: ["react", "valtio"],
      },
    },
    plugins: [
      react(), 
      externalGlobals({ react: "React", valtio: "Valtio" }),
      // 自定义插件：复制CSS文件到dist目录
      {
        name: 'copy-css-files',
        writeBundle() {
          // 确保dist目录存在
          const distDir = resolve(process.cwd(), 'dist');
          if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
          }
          
          // 复制styles.css
          const srcStylesPath = resolve(process.cwd(), 'src/styles.css');
          const distStylesPath = resolve(distDir, 'styles.css');
          if (existsSync(srcStylesPath)) {
            copyFileSync(srcStylesPath, distStylesPath);
            console.log('✅ Copied src/styles.css to dist/styles.css');
          }
          
          // 复制tag-value-color.css
          const srcTagValuePath = resolve(process.cwd(), 'src/tag-value-color.css');
          const distTagValuePath = resolve(distDir, 'tag-value-color.css');
          if (existsSync(srcTagValuePath)) {
            copyFileSync(srcTagValuePath, distTagValuePath);
            console.log('✅ Copied src/tag-value-color.css to dist/tag-value-color.css');
          }
        }
      }
    ],
  };
});
