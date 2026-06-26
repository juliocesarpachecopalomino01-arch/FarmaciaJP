import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Edit, Plus, Power, PowerOff, Search, Tags, X } from 'lucide-react';
import { PresentationType, productPresentationsApi } from '../api/products';
import './PresentationTypes.css';

type FormState = {
  name: string;
  description: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  name: '',
  description: '',
  is_active: true,
};

const isActive = (item: PresentationType) => Number(item.is_active ?? 1) === 1;

const normalizeText = (value = '') =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  const response = (err as { response?: { data?: { error?: string; message?: string; errors?: Array<{ msg?: string }> } } })?.response;
  return response?.data?.error || response?.data?.message || response?.data?.errors?.[0]?.msg || 'No se pudo completar la accion.';
};

export default function PresentationTypes() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PresentationType | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data: types = [], isLoading } = useQuery(['presentation-types'], productPresentationsApi.getTypes);

  const filteredTypes = useMemo(() => {
    const needle = normalizeText(search.trim());
    if (!needle) return types;
    return types.filter((item) => normalizeText(`${item.name} ${item.description || ''}`).includes(needle));
  }, [search, types]);

  const stats = useMemo(
    () => ({
      total: types.length,
      active: types.filter(isActive).length,
      inactive: types.filter((item) => !isActive(item)).length,
    }),
    [types]
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const saveMutation = useMutation(
    async () => {
      const name = form.name.trim();
      if (!name) throw new Error('Ingresa el nombre de la presentacion.');

      const payload = {
        name,
        description: form.description.trim(),
        is_active: form.is_active ? 1 : 0,
      };

      if (editing) return productPresentationsApi.updateType(editing.id, payload);
      return productPresentationsApi.createType(payload);
    },
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries(['presentation-types']);
        setFeedback({ type: 'success', text: editing ? 'Presentacion actualizada.' : 'Presentacion creada.' });
        closeModal();
      },
      onError: (err) => setFeedback({ type: 'error', text: getErrorMessage(err) }),
    }
  );

  const toggleMutation = useMutation(
    ({ item, nextActive }: { item: PresentationType; nextActive: boolean }) =>
      productPresentationsApi.updateType(item.id, {
        name: item.name,
        description: item.description || '',
        is_active: nextActive ? 1 : 0,
      }),
    {
      onSuccess: async (_, vars) => {
        await queryClient.invalidateQueries(['presentation-types']);
        setFeedback({ type: 'success', text: vars.nextActive ? 'Presentacion activada.' : 'Presentacion desactivada.' });
      },
      onError: (err) => setFeedback({ type: 'error', text: getErrorMessage(err) }),
    }
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFeedback(null);
    setModalOpen(true);
  };

  const openEdit = (item: PresentationType) => {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description || '',
      is_active: isActive(item),
    });
    setFeedback(null);
    setModalOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <div className="presentation-types-page">
      <div className="presentation-types-header">
        <div>
          <h1>Presentaciones</h1>
          <p>Crea, edita y desactiva los tipos usados en la venta de productos.</p>
        </div>
        <button className="presentation-types-btn primary" type="button" onClick={openCreate}>
          <Plus size={16} />
          Nueva presentacion
        </button>
      </div>

      <div className="presentation-types-stats">
        <div className="presentation-types-stat blue">
          <Tags size={18} />
          <div>
            <strong>{stats.total}</strong>
            <span>Total</span>
          </div>
        </div>
        <div className="presentation-types-stat green">
          <Power size={18} />
          <div>
            <strong>{stats.active}</strong>
            <span>Activas</span>
          </div>
        </div>
        <div className="presentation-types-stat orange">
          <PowerOff size={18} />
          <div>
            <strong>{stats.inactive}</strong>
            <span>Inactivas</span>
          </div>
        </div>
      </div>

      {feedback && (
        <div className={`presentation-types-feedback ${feedback.type}`}>
          {feedback.text}
          <button type="button" onClick={() => setFeedback(null)} aria-label="Cerrar mensaje">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="presentation-types-filter">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre o descripcion..."
        />
      </div>

      <div className="presentation-types-table-wrap">
        <table className="presentation-types-table">
          <thead>
            <tr>
              <th>Presentacion</th>
              <th>Descripcion</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="presentation-types-empty">
                  Cargando presentaciones...
                </td>
              </tr>
            ) : filteredTypes.length === 0 ? (
              <tr>
                <td colSpan={4} className="presentation-types-empty">
                  No hay presentaciones para mostrar.
                </td>
              </tr>
            ) : (
              filteredTypes.map((item) => {
                const active = isActive(item);
                return (
                  <tr key={item.id} className={!active ? 'inactive' : ''}>
                    <td className="presentation-types-name">{item.name}</td>
                    <td>{item.description || '-'}</td>
                    <td>
                      <span className={`presentation-types-badge ${active ? 'active' : 'inactive'}`}>
                        {active ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td>
                      <div className="presentation-types-actions">
                        <button type="button" title="Editar" onClick={() => openEdit(item)}>
                          <Edit size={14} />
                        </button>
                        <button
                          type="button"
                          title={active ? 'Desactivar' : 'Activar'}
                          onClick={() => toggleMutation.mutate({ item, nextActive: !active })}
                          disabled={toggleMutation.isLoading}
                          className={active ? 'danger' : 'success'}
                        >
                          {active ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="presentation-types-modal-backdrop" role="dialog" aria-modal="true">
          <form className="presentation-types-modal" onSubmit={handleSubmit}>
            <div className="presentation-types-modal-head">
              <div>
                <h2>{editing ? 'Editar presentacion' : 'Nueva presentacion'}</h2>
                <p>{editing ? 'Actualiza los datos del tipo seleccionado.' : 'Registra un nuevo tipo para asociarlo a productos.'}</p>
              </div>
              <button type="button" onClick={closeModal} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>

            <label>
              Nombre *
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Ej. Caja, Frasco, Blister"
                autoFocus
              />
            </label>

            <label>
              Descripcion
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Uso interno opcional..."
                rows={3}
              />
            </label>

            <label className="presentation-types-check">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
              />
              Activa para nuevas presentaciones de venta
            </label>

            <div className="presentation-types-modal-actions">
              <button type="button" className="presentation-types-btn" onClick={closeModal}>
                Cancelar
              </button>
              <button type="submit" className="presentation-types-btn primary" disabled={saveMutation.isLoading}>
                {saveMutation.isLoading ? 'Guardando...' : editing ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
