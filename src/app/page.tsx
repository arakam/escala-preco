import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas p-8">
      <Image
        src="/logo.png"
        alt="Escala Preço"
        width={400}
        height={112}
        className="h-28 w-auto object-contain sm:h-36"
        priority
      />
      <p className="text-fg">Integração com Mercado Livre</p>
      <div className="flex gap-4">
        <Link
          href="/auth/login"
          className="rounded bg-brand-blue px-4 py-2 font-medium text-white transition hover:bg-brand-blue-dark"
        >
          Entrar
        </Link>
        <Link
          href="/auth/register"
          className="rounded border border-brand-blue bg-card px-4 py-2 font-medium text-brand-blue transition hover:bg-brand-blue hover:text-white dark:border-blue-400 dark:text-blue-300 dark:hover:text-white"
        >
          Cadastrar
        </Link>
      </div>
    </main>
  );
}
